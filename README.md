# s3-tune
__Backup and restore AWS S3.__

This tool can achieve synchronizations as:
*	directory → bucket
*	bucket → directory 

Here, *directory* is located in local file system and made up of files and sub directories, while *bucket* is vessel in S3 where objects saved.

##	Table of Contents

* [Links](#links)
* [Get Started](#get-started)
* [AWS Config](#aws-config)
* [CLI](#cli)
* [API](#api)
	* [Parameter `options`](#parameter-options)
	* [Get Into Sync Progress](#get-into-sync-progress)
	* [Progress Events](#progress-events)
		* [Event: 'created'  ](#event-created-)
		* [Event: 'end'  ](#event-end-)
		* [Event: 'error'  ](#event-error-)
		* [Event: 'ignored'  ](#event-ignored-)
		* [Event: 'moveon'  ](#event-moveon-)
		* [Event: 'no-utf8-filename'](#event-no-utf8-filename)
		* [Event: 'skipped'  ](#event-skipped-)
		* [Event: 'warning'  ](#event-warning-)

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

__s3-tune__ offers functions to achieve two different tasks:

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

For convenience, triditional invoking styles are also supported:

*	void __backup__(object *options*, Function *callback*)
*	void __restore__(object *options*, Function *callback*)
*	Promise __backup.promise__(object *options*)
*	Promise __restore.promise__(object *options*)

In traditional styles, the task is regarded as resolved only when all objects successfully uploaded or downloaded. Even if only one failure (something ignored) happens, it fails!

###	Parameter `options`

*	AWS.S3 __options.s3__  
	Instance of [`AWS.S3`](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html).

*	string __options.bucket__  
	S3 bucket name.

*	string __options.directory__  
	Absolute pathname in local file system.

*	string __options.marker__  
	Position indicating where to start.  
	The marker should be an object name.

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

*	number __options.maxQueueing__  
	Maximum queue length allowed.  
	When the queue length reaches this number, the progress will pause finding more objects / files until some in queue finished.

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

###	Progress Events

Function `s3tune.restore()` or `s3tune.backup()` will return an instance of [`jinang/Progress`](https://github.com/YounGoat/jinang/blob/HEAD/docs/Progress.md). And the returned `progress` is also an instance of `events.EventEmitter` and may emit following events:

*	[created](#event-created)
*	[end](#event-created)
*	[error](#event-created)
*	[ignored](#event-created)
*	[moveon](#event-created)
*	[no-utf8-filename](#event-no-utf8-filename)
*	[skipped](#event-created)
*	[warning](#event-created)

Following the conventions in [Node.js Documentation](https://nodejs.org/docs/latest/api/), the avaiable event data will be written in list which follows the section title. E.g.

```javascript
progress.on('fallInLove', function(boy, girl /* , ... */) {
	// ...
});
```

Aavailable event data will be listed under the event title. Looks like:  
__Events: 'fallInLove'__
*	Person __*boy*__
	*	string __*name*__
	*	number __*age*__
*	Person __*girl*__
	*	string __*name*__
	*	number __*age*__

Not all events are emitted with data. And some or sometimes will be emitted with more than one parameter.

####	Event: 'created'  

*	Object __*meta*__
	*	string __*name*__  
		Name of object, also the relative pathname of file.

Emitted each time an object put to S3 bucket (in restore mode), or a file written in local file system (in backup mode).

####	Event: 'end'  

*	Object __*stat*__
	*	number __*errors*__  
		Total errors caught.
	*	number __*created*__  
		Total objects or files created.
	*	number __*ignored*__  
		Total objects or files ignored because of exceptions.

Emitted when the progress accomplished or terminated on too many errors. See `options.maxErrors` in [Parameter options](#parameter-options).

####	Event: 'error'  

*	Error __*error*__
*	Object __*stat*__  
	See [Event: 'end'](#event-end) for details of *stat*.

An __error__ event will be emitted only when:

1. 	some exception happens when putting object to S3 or writing file in local file system, and 
2.	it can not be overcome by retrying in limited times.   

If there are retry chances left, an [Event: 'warning'](#event-warning) will be emitted instead.

See `options.retry` in [Parameter options](#parameter-options).

####	Event: 'ignored'  

See [Event: 'created'](#event-created) for associated event data.

Emitted each time failed to put an object to S3 bucket, or to write a file to local file system. 

####	Event: 'moveon'  

*	string __*marker*__  
	Actually, the mark is just the name of object to which the cursor points.

In functions `s3tune.backup()` and `s3tune.restore()`, multiple create operations will be made concurrently. The create operations begin in sequence but not always end in the same order. Event __moveon__ will be emitted when something finished (['created'](#event-created) or ['ignored'](#event-ignored)), and all those ranked ahead have also been finished.

If the progress terminated by exceptions, you can restart it from the position marked by *marker*.

See `options.marker` in [Parameter options](#parameter-options). 

####	Event: 'no-utf8-filename'

*	Object __*fileInfo*__
	*	string __*dirname*__
	*	Buffer __*filenameBuffer*__

Only emitted in `s3tune.restore()`, each time on meeting with file or directory whose name is not utf-8 encoded. Such file or directory will not be restored to S3 bucket and no ['ignored'](#event-ignored) or ['skipped'](#event-skipped) will be emitted.

####	Event: 'skipped'  

See [Event: 'created'](#event-created) for associated event data.

Emmited each time when something skipped by the filter.

See `options.filter` and `options.dualMetaFilter__` in [Parameter options](#parameter-options).

	
####	Event: 'warning'  

*	Error __*error*__
*	Object __*stat*__  
	See [Event: 'end'](#event-end) for details of *stat*.

A __warning__ event will be emitted only when:

1. 	some exception happens when putting object to S3 or writing file in local file system, and 
2.	there are still chances left to retry.   

When all retry chances are exhausted, an [Event: 'error'](#event-error) will be emitted instead.

See `options.retry` in [Parameter options](#parameter-options).
