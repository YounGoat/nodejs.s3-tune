# s3-tune
__Backup and restore AWS S3.__

This tool can achieve synchronizations as:
*	directory → bucket
*	bucket → directory 

Here, *directory* is located in local file system and made up of files and sub directories, while *bucket* is vessel in S3 where objects saved.

##	Table of Contents

*	[Get Started](#get-started)
*	[Connection Config](#connection-config)
*	[API](#api)

##	Links

*	[CHANGE LOG](./CHANGELOG.md)
*	[Homepage](https://github.com/YounGoat/s3-sync)

##	Get Started

In CLI:
```bash
# Command "s3-tune" will be generated.
npm install -g s3-tune

# Show help info.
s3-tune -h

# Backup objects into local directory.
s3-tune backup --aws-config <config.json> --bucket <bucket-name> --directory <path-name>

# Restore objects to AWS S3 bucket.
s3-tune restore --aws-config <config.json> --bucket <bucket-name> --directory <path-name>
```

As API:

```javascript
const backupS3 = require('s3-sync/backup');

const progress = backupS3(options);

progress.on('error', (err) => {
	// ...
});

progress.on('end', (meta) => {
	// Sychronization successfully finished.
});
```

##	AWS Config

For CLI usage, the *config.json* is a JSON file which contains necessary properties required to access AWS resources. See [Class: AWS.Config](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Config.html) for details.

Here is a dummy example: 
```javascript
{
	// 20-character Id
	"accessKeyId": "1234567890ABCDEFGHIJKLMNOPQ", 
	
	// 40-character key
	"secretAccessKey": "1234567890abcdefghijklmnopqrstuvwxyz1234" 
}
```

In API mode, an instance of `AWS.S3` should be passed through with name `options.s3`.

##	CLI

When installed globally, __s3-tune__ will create a homonymous global command. Run `s3-tune -h` in terminal to print the man page.

__s3-tune__ will occupy a hidden directory named `.s3-tune` in home directory of current user.

##	API

__s3-tune__ offers two functions to achieve different tasks:

*	jinang/Progress __backup__(object *options*)
*	jinang/Progress __restore__(object *options*)

1.	The functions accept similar *options* argument, see section [Parameter `options`](#parameter-options) for details.
1.	The functions are all asynchronous and will return an instance of [jinang/Progress](https://www.npmjs.com/package/jinang#progress). Via the returned value, we may learn about and control the sync progress. See section [Get Into Sync Progress](#get-into-sync-progress) for details.

Each function may be required solely:

```javascript
const s3tune    = require('s3-tune');
const s3backup  = require('s3-tune/backup');
const s3restore = require('s3-tune/restore');

// E.g., next two functions are equivalent.
s3tune.backup
s3backup
```

###	Parameter `options`

*	string[] __options.names__  
	Object names to be stored into or restored from local file system.

*	Function __options.mapper__
	Object name mapper.

*	Function __options.filter__
	Object name filter.  
	For `s3tune.restore()` only.

*	Function __options.dualMetaFilter__
	Filter with paramenter `(stat, meta)`.  
	For `s3tune.restore()` only.

* 	number __options.maxCreated__  
	Maximum creation allowed (then the progress will be terminated).

*	number __options.maxCreating__  
	Maximum cocurrent creating operation allowed.

*	number __options.maxErrors__  
	Maximum exceptions allowed (then the progress will be terminated).

*	number __options.retry__  
	Maximum retry times on exception for each object or object list.

###	Get Into Sync Progress

Via the returned instance of `jinang/Progress`, we may learn about what happened and then control the sync progress.

*	__progress.on__(string *eventName*, Function *listener*)  
	See section [Events During Sync Progress](#events-during-sync-progress) for aviable events and their accompanied arguments.

*	__progress.abort__()  
	Terminate the progress as soon as possible.

*	__progress.quit__()  
	Quit the progress gracefully.

###	Events During Sync Progress

####	Event: '__created__'  
*	Object *meta*

####	Event: '__moveon__'  
*	string *mark*

####	Event: '__ignored__'  
*	Object *meta*

####	Event: '__skipped__'  
*	Object *meta*
	
####	Event: '__warning__'  
*	Error *error*

####	Event: '__error__'  
*	Error *error*

####	Event: '__end__'  
*	Object *meta*  
	```javascript
	{
		errors /* number */,
		created /* number */, 
		ignored /* number */,
	}
	```