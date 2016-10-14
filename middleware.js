/*
 MIT License http://www.opensource.org/licenses/mit-license.php
 Author Tobias Koppers @sokra
 */
var mime = require("mime");
var getFilenameFromUrl = require("./lib/GetFilenameFromUrl");
var Shared = require("./lib/Shared");
var pathJoin = require("./lib/PathJoin");

var HASH_REGEXP = /[0-9a-f]{10,}/;


// constructor for the middleware
module.exports = function (compiler, options) {

	var context = {
		state: false,
		webpackStats: undefined,
		callbacks: [],
		options: options,
		compiler: compiler,
		watching: undefined,
		forceRebuild: false
	};
	var shared = Shared(context);


	// The middleware function
	function webpackDevMiddleware(req, res, next) {
		function goNext() {
			if(!context.options.serverSideRender) return next();
			shared.ready(function () {
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
			shared.rebuild();

		if(HASH_REGEXP.test(filename)) {
			try {
				if(context.fs.statSync(filename).isFile()) {
					processRequest();
					return;
				}
			} catch (e) {
			}
		}
		// delay the request until we have a valid bundle
		shared.ready(processRequest, req);

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
			} catch (e) {
				return goNext();
			}

			// server content
			var content = context.fs.readFileSync(filename);
			content = shared.handleRangeHeaders(content, req, res);
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
	webpackDevMiddleware.waitUntilValid = shared.waitUntilValid;
	webpackDevMiddleware.invalidate = shared.invalidate;
	webpackDevMiddleware.close = shared.close;
	webpackDevMiddleware.fileSystem = context.fs;
	return webpackDevMiddleware;
};

// constructor for the middleware
module.exports.direct = function (compiler, options) {

	var context = {
		state: false,
		webpackStats: undefined,
		callbacks: [],
		options: options,
		compiler: compiler,
		watching: undefined,
		forceRebuild: false
	};
	var shared = Shared(context);


	// The direct interface
	function webpackDevDirect(opts, cb) {
		var options = context.options;
		var fs = context.fs;
		var filename = opts.src;
		// in lazy mode, rebuild on bundle request
		if(options.lazy && (!options.filename || options.filename.test(filename)))
			this.rebuild();

		if(HASH_REGEXP.test(filename)) {
			try {
				if(fs.statSync(filename).isFile()) {
					processRequest();
					return;
				}
			} catch (e) {
			}
		}
		// delay the request until we have a valid bundle
		shared.ready(processRequest);
		function processRequest() {
			var stat = context.fs.statSync(filename);
			if(!stat.isFile()) {
				return cb(new Error("invalid file was requested: " + filename));
			}
			fs.readFile(filename, function (err, content) {
				if(err) {
					return cb(new Error("error reading file: " + filename));
				}
				cb(null, content);
			});
		}
	}
	webpackDevDirect.waitUntilValid = shared.waitUntilValid;
	webpackDevDirect.invalidate = shared.invalidate;
	webpackDevDirect.close = shared.close;
	webpackDevDirect.fileSystem = context.fs;
	return webpackDevDirect;
};

