/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/
var mime = require("mime");
var getFilenameFromUrl = require("./lib/GetFilenameFromUrl");
var Util = require('./lib/utils');
var pathJoin = require("./lib/PathJoin");

var HASH_REGEXP = /[0-9a-f]{10,}/;
var EventEmitter = require('events');



// constructor for the middleware
module.exports = function(compiler, options) {

	var context = {
		state: false,
		eventEmitter: new EventEmitter(),
		webpackStats: undefined,
		callbacks: [],
		options: undefined,
		compiler: compiler,
		watching: undefined,
		forceRebuild: false
	};
	var util = Util(context);
	util.setOptions(options);
	util.setFs(context.compiler);
	context.eventEmitter.on('compiler:done', function (stats) {
		// We are now on valid state
		context.state = true;
		context.webpackStats = stats;

		// Do the stuff in nextTick, because bundle may be invalidated
		// if a change happened while compiling
		process.nextTick(function() {
			// check if still in valid state
			if(!context.state) return;
			// print webpack output
			context.options.reporter({
				state: true,
				stats: stats,
				options: context.options
			});

			// execute callback that are delayed
			var cbs = context.callbacks;
			context.callbacks = [];
			cbs.forEach(function continueBecauseBundleAvailable(cb) {
				cb(stats);
			});
		});

		// In lazy mode, we may issue another rebuild
		if(context.forceRebuild) {
			context.forceRebuild = false;
			util.rebuild();
		}
	});

	// on compiling
	context.eventEmitter.on('compiler:invalid', function invalidPlugin() {
		if(context.state && (!context.options.noInfo && !context.options.quiet))
			context.options.reporter({
				state: false,
				options: context.options
			});

		// We are now in invalid state
		context.state = false;
		//resolve async
		if (arguments.length === 2 && typeof arguments[1] === 'function') {
			var callback = arguments[1];
			callback();
		}
	});


	context.compiler.plugin("done", util.compilerDone);
	context.compiler.plugin("invalid", util.compilerInvalid);
	context.compiler.plugin("watch-run", util.compilerInvalid);
	context.compiler.plugin("run", util.compilerInvalid);

	util.startWatch();

	// The middleware function
	function webpackDevMiddleware(req, res, next) {
		function goNext() {
			if(!context.options.serverSideRender) return next();
			util.ready(function() {
				res.locals.webpackStats = context.webpackStats;
				next();
			}, req);
		}

		if(req.method !== "GET") {
			return goNext();
		}

		var filename = getFilenameFromUrl(context.options.publicPath, context.compiler.outputPath, req.url);
		if(filename === false) return goNext();

		// in lazy mode, rebuild on bundle request
		if(context.options.lazy && (!context.options.filename || context.options.filename.test(filename)))
			util.rebuild();

		if(HASH_REGEXP.test(filename)) {
			try {
				if(context.fs.statSync(filename).isFile()) {
					processRequest();
					return;
				}
			} catch(e) {}
		}
		// delay the request until we have a valid bundle
		util.ready(processRequest, req);

		function processRequest() {
			try {
				var stat = context.fs.statSync(filename);
				if(!stat.isFile()) {
					if(stat.isDirectory()) {
						filename = pathJoin(filename, context.options.index || "index.html");
						stat = context.fs.statSync(filename);
						if(!stat.isFile()) throw "next";
					} else {
						throw "next";
					}
				}
			} catch(e) {
				return goNext();
			}

			// server content
			var content = context.fs.readFileSync(filename);
			content = util.handleRangeHeaders(content, req, res);
			res.setHeader("Access-Control-Allow-Origin", "*"); // To support XHR, etc.
			res.setHeader("Content-Type", mime.lookup(filename) + "; charset=UTF-8");
			res.setHeader("Content-Length", content.length);
			if(context.options.headers) {
				for(var name in context.options.headers) {
					res.setHeader(name, context.options.headers[name]);
				}
			}
			// Express automatically sets the statusCode to 200, but not all servers do (Koa).
			res.statusCode = res.statusCode || 200;
			if(res.send) res.send(content);
			else res.end(content);
		}
	}

	webpackDevMiddleware.getFilenameFromUrl = getFilenameFromUrl.bind(this, context.options.publicPath, context.compiler.outputPath);
	webpackDevMiddleware.waitUntilValid = util.waitUntilValid;
	webpackDevMiddleware.invalidate = util.invalidate;
	webpackDevMiddleware.close = util.close;
	webpackDevMiddleware.fileSystem = context.fs;
	return webpackDevMiddleware;
};
