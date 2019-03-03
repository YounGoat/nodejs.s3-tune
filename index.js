'use strict';

const MODULE_REQUIRE = 1
	/* built-in */
	
	/* NPM */
	, noda = require('noda')
	
	/* in-package */
	, restore = noda.inRequire('restore')
	, backup = noda.inRequire('backup')
	;

module.exports = {
	backup,
	restore,
};
