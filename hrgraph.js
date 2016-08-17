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
	console.log('Usage: hrgraph.js [OPTIONS] FILES..');
	console.log('  --output FILE.html  Write HTML file');
	console.log('  --cache FILE.json   Write json cache file of all timestamps');
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

function plot(day, svg, min_daysecond, max_daysecond, min_hr, max_hr) {
	const width = 1000;
	const height = 150;

	svg.attr('width', width);
    svg.attr('height', height);

	var x = d3.scale.linear()
	    .range([0, width]);
	var y = d3.scale.linear()
		.range([height, 0]);
    
	var xAxis = d3.svg.axis()
		.scale(x)
		.orient('bottom');

	var yAxis = d3.svg.axis()
		.scale(y)
		.orient('left');

	var line = d3.svg.line()
		.x(dp => x(dp.daysecond))
		.y(dp => y(dp.hr));

	x.domain([min_daysecond, max_daysecond]);
	y.domain([min_hr, max_hr]);

	var g = svg.append('g');
	g.append('path')
		.datum(day.data)
		.attr('class', 'line')
		.attr('d', line);

  svg.append("g")
      .attr("class", "x axis")
      .attr("transform", "translate(0," + height + ")")
      .call(xAxis);

  svg.append("g")
      .attr("class", "y axis")
      .call(yAxis)
    .append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", 6)
      .attr("dy", ".71em")
      .style("text-anchor", "end")
      .text("Price ($)");
}

function main() {
	var argv = require('minimist')(process.argv.slice(2));
	if (argv.help || !argv._.length) {
		help();
		return;
	}
	async.map(argv._, parseFile, function(err, dp_lists) {
		if (err) throw err;
		
		var datapoints = [].concat(...dp_lists);
		datapoints.sort(function(dp1, dp2) {
			return dp1.timestamp - dp2.timestamp;
		});
		for (let dp of datapoints) {
			let dp_date = new Date(dp.timestamp);
			dp.daysecond = dp_date.getHours() * 3600 + dp_date.getMinutes() * 60 + dp_date.getSeconds();
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


		var doc = jsdom.jsdom(`<!DOCTYPE html><html><head><style>
.axis path,
.axis line {
  fill: none;
  stroke: #000;
  shape-rendering: crispEdges;
}

.line {
  fill: none;
  stroke: steelblue;
  stroke-width: 1px;
}
</style>
</head><body></body></html>`);
		var body = d3.select(doc).select('body');

		for (let day of days) {
			let date = day.date;
			let day_str = DAY_NAMES[date.getDay()] + ' ' + date.getFullYear() + '-' + pad(2, '0', date.getMonth() + 1) + '-' + pad(2, '0', date.getDate());

			body.append('h2').text(day_str);
			let svg = body.append('svg');

			plot(day, svg, min_daysecond, max_daysecond, min_hr, max_hr);
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
