#!/usr/bin/env node
'use strict';

var async = require('async');
var fs = require('fs');
var xmldom = require('xmldom');

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
		} else {
			cb(new Error('Unknown file format of ' + fn));
		}
	});
}

function help() {
	console.log('Usage: hrgraph.js FILES..');
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

		console.log(datapoints);

		// TODO split by days

		// TODO set up plot
		// TODO plot each

		// TODO write output file
	});
}


if (require.main === module) {
	main();
}
