#!/usr/bin/env node
'use strict';

var async = require('async');
var d3 = require('d3');
var jsdom = require('jsdom');
var fs = require('fs');
var xmldom = require('xmldom');

const DAY_NAMES = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function pad(n, c, v) {
	var s = '' + v;
	while (s.length < n) {
		s = c + s;
	}
	return s;
}

function parseXML(contents, cb) {
	var parser = new xmldom.DOMParser();
	var doc = parser.parseFromString(contents);
	cb(null, doc);
}

function parseTcx(doc, cb) {
	var res = [];
	var trackpoints = doc.getElementsByTagName('Trackpoint');
	for (var i = 0;i < trackpoints.length;i++) {
		let tp = trackpoints[i];
		let time_str = tp.getElementsByTagName('Time')[0].textContent;
		let timestamp = Date.parse(time_str);

		let hrNodes = tp.getElementsByTagName('HeartRateBpm');
		if (hrNodes.length === 0) {
			continue;
		}
		let hr = parseInt(hrNodes[0].getElementsByTagName('Value')[0].textContent, 10);

		res.push({
			hr,
			timestamp,
		});
	}
	return cb(null, res);
}

// Returns a list of data points
function parseFile(fn, cb) {
	fs.readFile(fn, {encoding: 'utf-8'}, function(err, contents) {
		if (err) return cb(err);

		if (/^\s*</.test(contents)) {
			parseXML(contents, function(err, doc) {
				if (err) return cb(err);
				parseTcx(doc, cb);
			});
		} else if (/^\{/.test(contents)) {
			let doc = JSON.parse(contents);
			if (!doc) {
				return cb(new Error('Failed to parse JSON file ' + fn));
			}
			cb(null, doc.datapoints);
		} else {
			cb(new Error('Unknown file format of ' + fn));
		}
	});
}

function help() {
	console.log('Usage: hrgraph.js [OPTIONS] FILE.tcx..');
	console.log('  --output FILE.html  Write HTML file');
	console.log('  --cache FILE.json   Write json cache file of all timestamps');
	console.log('  --title TITLE       Document title');
	console.log('  --smooth SECONDS    Only record values every x seconds');
	console.log('  --start-time HH:MM  Start at specified time');
	console.log('  --end-time HH:MM    End at specified time');
	console.log('  --width WIDTH       Width of image in pixels');
	console.log('  --height HEIGHT     Height of image in pixels');
}

function splitDays(datapoints) {
	var res = [];
	var data_by_day = {};
	for (var dp of datapoints) {
		var date = new Date(dp.timestamp);
		var day = date.getFullYear() + '-' + pad(2, '0', date.getMonth() + 1) + '-' + pad(2, '0', date.getDate());

		var d = data_by_day[day];
		if (! d) {
			d = [];
			data_by_day[day] = d;
			res.push({
				date: date,
				data: d,
			});
		}

		d.push(dp);
	}

	return res;
}

function plot(day, svg, min_daysecond, max_daysecond, min_hr, max_hr, width, height) {
	const margin = {top: 10, right: 10, bottom: 20, left: 50};
	const inner_width = width - margin.left - margin.right;
	const inner_height = height - margin.top - margin.bottom;

	svg.attr('width', width);
	svg.attr('height', height);

	var x = d3.scale.linear()
		.range([0, inner_width]);
	var y = d3.scale.linear()
		.range([inner_height, 0]);

	var tickValues = d3.range(
		Math.ceil(min_daysecond / 1800) * 1800,
		Math.floor(max_daysecond / 1800) * 1800,
		1800);
	var xAxis = d3.svg.axis()
		.scale(x)
		.tickValues(tickValues)
		.innerTickSize(-inner_height)
		.outerTickSize(0)
		.tickFormat(secs => (secs % 3600 !== 0) ? '' : pad(2, '0', Math.floor(secs / 3600)) + ':' + pad(2, '0', Math.floor((secs % 3600) / 60)))
		.orient('bottom');

	var yAxis = d3.svg.axis()
		.scale(y)
		.innerTickSize(-inner_width)
		.outerTickSize(0)
		.orient('left');

	var line = d3.svg.line()
		.x(dp => x(dp.daysecond))
		.y(dp => y(dp.hr));

	x.domain([min_daysecond, max_daysecond]);
	y.domain([min_hr, max_hr]);

	var root = svg.append('g')
		.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

	root.append('g')
		.attr('class', 'x axis')
		.attr('transform', 'translate(0,' + inner_height + ')')
		.call(xAxis);

	root.append('g')
		.attr('class', 'y axis')
		.call(yAxis)
		.append('text')
		.attr('transform', 'rotate(-90)')
		.attr('y', 6)
		.attr('dy', '.71em')
		.style('text-anchor', 'end')
		.text('Puls');

	root.append('path')
		.datum(day.data)
		.attr('class', 'line')
		.attr('d', line);
}

function smooth(datapoints, secs) {
	var prev = datapoints[0];
	var res = [datapoints[0]];

	for (var dp of datapoints) {
		if ((prev.timestamp + (secs * 1000) < dp.timestamp) || (Math.abs(dp.hr - prev.hr) > 5)) {
			prev = dp;
			res.push(dp);
		}
	}
	return res;
}

function _parse_time(timestr) {
	const m = /^([0-9]{1,2}):([0-9]{1,2})(?::([0-9]{1,2}))?$/.exec(timestr);
	if (!m) {
		throw new Error('Invalid time ' + timestr);
	}
	return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + (m[3] ? parseInt(m[3]) : 0);
}

function main() {
	var argv = require('minimist')(process.argv.slice(2));
	if (argv.help || !argv._.length) {
		help();
		return;
	}

	const start_time = argv['start-time'] ? _parse_time(argv['start-time'])  : null;
	const end_time = argv['end-time'] ? _parse_time(argv['end-time']) : null;

	const width = argv.width ? parseInt(argv.width) : 1200;
	const height = argv.height ? parseInt(argv.height) : 250;

	async.map(argv._, parseFile, function(err, dp_lists) {
		if (err) throw err;
		
		var datapoints = [].concat(...dp_lists);
		datapoints.sort(function(dp1, dp2) {
			return dp1.timestamp - dp2.timestamp;
		});
		if (argv.smooth) {
			datapoints = smooth(datapoints, parseInt(argv.smooth, 10));
		}

		for (let dp of datapoints) {
			let dp_date = new Date(dp.timestamp);
			dp.daysecond = dp_date.getHours() * 3600 + dp_date.getMinutes() * 60 + dp_date.getSeconds();
		}

		if (start_time) {
			datapoints = datapoints.filter(dp => dp.daysecond >= start_time);
		}
		if (end_time) {
			datapoints = datapoints.filter(dp => dp.daysecond <= end_time);
		}

		var min_daysecond = d3.min(datapoints, dp => dp.daysecond);
		var max_daysecond = d3.max(datapoints, dp => dp.daysecond);
		var min_hr = d3.min(datapoints, dp => dp.hr);
		var max_hr = d3.max(datapoints, dp => dp.hr);

		if (argv.cache) {
			var datapoints_json = JSON.stringify({
				'datapoints': datapoints,
			});
			fs.writeFileSync(argv.cache, datapoints_json);
		}

		var days = splitDays(datapoints);

		var doc = jsdom.jsdom(`<!DOCTYPE html><html><head>
<meta charset="utf-8" />
<title></title>
<style>
.axis path,
.axis line {
  fill: none;
  stroke: #000;
  shape-rendering: crispEdges;
}

.axis .tick line {
    stroke: lightgrey;
    opacity: 0.7;
}

.line {
  fill: none;
  stroke: steelblue;
  stroke-width: 0.8px;
}
</style>
</head><body></body></html>`);
		if (argv.title) {
			d3.select(doc).select('title').text(argv.title);
		}
		var body = d3.select(doc).select('body');

		for (let day of days) {
			let date = day.date;
			let day_str = DAY_NAMES[date.getDay()] + ' ' + date.getFullYear() + '-' + pad(2, '0', date.getMonth() + 1) + '-' + pad(2, '0', date.getDate());

			body.append('h2').text(day_str);
			let svg = body.append('svg');

			plot(day, svg, min_daysecond, max_daysecond, min_hr, max_hr, width, height);
		}

		var html = doc.documentElement.outerHTML;
		if (argv.output) {
			fs.writeFileSync(argv.output, html);
		} else {
			console.log(html);
		}
	});
}


if (require.main === module) {
	main();
}
