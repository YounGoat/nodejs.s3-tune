'use strict';

const MODULE_REQUIRE = 1
	/* built-in */
	
	/* NPM */
	, ott = require('jinang/ott')

	/* in-package */
	;

function asynchronise(fn) {
	let newFn = function(options, callback) {
		if (!callback) {
			return fn(options);
		}
		
		let callback2 = ott.once(callback);

		try {
			let progress = fn(options);

			progress.on('error', err => {
				callback2(err);
				progress.abort();
			});

			progress.on('end', stat => {
				// If anything ignored, progress event "error" should be emitted 
				// and the `reject()` will be called immediately.
				// Here `stat.ignored` should always equal to 0.
				if (stat.ignored) {
					callback2(new Error(`${stat.ignored} objects ignored`), stat);
				}
				else {
					callback2(null, stat);
				}
			});
		} catch(ex) {
			callback2(ex);
		}
	};

	newFn.promise = function(options) {
		return new Promise((resolve, reject) => {
			newFn(options, (err, stat) => {
				err ? reject(err) : resolve(stat);
			});
		});
	};

	return newFn;
}

module.exports = asynchronise;