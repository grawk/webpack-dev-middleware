var parseRange = require("range-parser");
var pathIsAbsolute = require("path-is-absolute");
var MemoryFileSystem = require("memory-fs");

module.exports = function shared(context) {
	var shared = {
		setOptions: function(options) {
			if(!options) options = {};
			if(typeof options.watchOptions === "undefined") options.watchOptions = {};
			if(typeof options.reporter !== "function") options.reporter = shared.defaultReporter;
			if(typeof options.log !== "function") options.log = console.log.bind(console);
			if(typeof options.warn !== "function") options.warn = console.warn.bind(console);
			if(typeof options.watchDelay !== "undefined") {
				// TODO remove this in next major version
				options.warn("options.watchDelay is deprecated: Use 'options.watchOptions.aggregateTimeout' instead");
				options.watchOptions.aggregateTimeout = options.watchDelay;
			}
			if(typeof options.watchOptions.aggregateTimeout === "undefined") options.watchOptions.aggregateTimeout = 200;
			if(typeof options.stats === "undefined") options.stats = {};
			if(!options.stats.context) options.stats.context = process.cwd();
			if(options.lazy) {
				if(typeof options.filename === "string") {
					var str = options.filename
						.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&")
						.replace(/\\\[[a-z]+\\\]/ig, ".+");
					options.filename = new RegExp("^[\/]{0,1}" + str + "$");
				}
			}
			context.options = options;
		},
		defaultReporter: function(reporterOptions) {
			var state = reporterOptions.state;
			var stats = reporterOptions.stats;
			var options = reporterOptions.options;

			if(state) {
				var displayStats = (!options.quiet && options.stats !== false);
				if(displayStats && !(stats.hasErrors() || stats.hasWarnings()) &&
					options.noInfo)
					displayStats = false;
				if(displayStats) {
					options.log(stats.toString(options.stats));
				}
				if(!options.noInfo && !options.quiet) {
					options.log("webpack: bundle is now VALID.");
				}
			} else {
				options.log("webpack: bundle is now INVALID.");
			}
		},
		handleRangeHeaders: function handleRangeHeaders(content, req, res) {
			res.setHeader("Accept-Ranges", "bytes");
			if(req.headers.range) {
				var ranges = parseRange(content.length, req.headers.range);

				// unsatisfiable
				if(-1 == ranges) {
					res.setHeader("Content-Range", "bytes */" + content.length);
					res.statusCode = 416;
				}

				// valid (syntactically invalid/multiple ranges are treated as a regular response)
				if(-2 != ranges && ranges.length === 1) {
					// Content-Range
					res.statusCode = 206;
					var length = content.length;
					res.setHeader(
						"Content-Range",
						"bytes " + ranges[0].start + "-" + ranges[0].end + "/" + length
					);

					content = content.slice(ranges[0].start, ranges[0].end + 1);
				}
			}
			return content;
		},
		setFs: function(compiler) {
			if(typeof compiler.outputPath === "string" && !pathIsAbsolute.posix(compiler.outputPath) && !pathIsAbsolute.win32(compiler.outputPath)) {
				throw new Error("`output.path` needs to be an absolute path or `/`.");
			}

			// store our files in memory
			var fs;
			var isMemoryFs = !compiler.compilers && compiler.outputFileSystem instanceof MemoryFileSystem;
			if(isMemoryFs) {
				fs = compiler.outputFileSystem;
			} else {
				fs = compiler.outputFileSystem = new MemoryFileSystem();
			}
			context.fs = fs;
		},
		compilerDone: function(stats) {
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
				shared.rebuild();
			}
		},
		compilerInvalid: function() {
			if(context.state && (!context.options.noInfo && !context.options.quiet))
				context.options.reporter({
					state: false,
					options: context.options
				});

			// We are now in invalid state
			context.state = false;
			//resolve async
			if(arguments.length === 2 && typeof arguments[1] === "function") {
				var callback = arguments[1];
				callback();
			}
		},
		ready: function ready(fn, req) {
			var options = context.options;
			if(context.state) return fn(context.webpackStats);
			if(!options.noInfo && !options.quiet)
				options.log("webpack: wait until bundle finished: " + (req && req.url || fn.name));
			context.callbacks.push(fn);
		},
		startWatch: function() {
			var options = context.options;
			var compiler = context.compiler;
			// start watching
			if(!options.lazy) {
				var watching = compiler.watch(options.watchOptions, function(err) {
					if(err) throw err;
				});
				context.watching = watching;
			} else {
				context.state = true;
			}
		},
		rebuild: function rebuild() {
			if(context.state) {
				context.state = false;
				context.compiler.run(function(err) {
					if(err) throw err;
				});
			} else {
				context.forceRebuild = true;
			}
		},
		waitUntilValid: function(callback) {
			callback = callback || function() {};
			shared.ready(callback, {});
		},
		invalidate: function(callback) {
			callback = callback || function() {};
			if(context.watching) {
				shared.ready(callback, {});
				context.watching.invalidate();
			} else {
				callback();
			}
		},
		close: function(callback) {
			callback = callback || function() {};
			if(context.watching) context.watching.close(callback);
			else callback();
		}
	};
	shared.setOptions(context.options);
	shared.setFs(context.compiler);

	context.compiler.plugin("done", shared.compilerDone);
	context.compiler.plugin("invalid", shared.compilerInvalid);
	context.compiler.plugin("watch-run", shared.compilerInvalid);
	context.compiler.plugin("run", shared.compilerInvalid);

	shared.startWatch();
	return shared;
};
