'use strict';

const MODULE_REQUIRE = 1
	/* built-in */
	
	/* NPM */

	/* in-package */
	;

function asynchronise(fn) {
	let newFn = function(options, callback) {
		let progress = fn(options);
		progress.on('end', stat => {
			if (stat.ignored) {
				callback(new Error(`${stat.ignored} objects ignored`), stat);
			}
			else {
				callback(null, stat);
			}
		});
	};

	newFn.promise = function(options) {
		return new Promise((resolve, reject) => {
			let progress = fn(options);
			progress.on('end', stat => {
				if (stat.ignored) {
					reject(new Error(`${stat.ignored} objects ignored`));
				}
				else {
					resolve(stat);
				}
			});
		});
	};

	return newFn;
}

module.exports = asynchronise;