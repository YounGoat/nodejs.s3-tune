#!/usr/bin/env node

'use strict';

const MODULE_REQUIRE = 1
    /* built-in */
    , crypto = require('crypto')
    , fs = require('fs')
    , os = require('os')
    , path = require('path')
    
    /* NPM */
    , AWS = require('aws-sdk')
    , commandos = require('commandos')
    , noda = require('noda')
    , JsonFile = require('jinang/JsonFile')
    , Directory = require('jinang/Directory')
    , cloneObject = require('jinang/cloneObject')
    , sort = require('jinang/sort')
    , uniq = require('jinang/uniq')
    
    /* in-package */

    /* in-file */
    , NL = '\n'
    ;

// ---------------------------
// Command line options validation.

const ACTIONS = ['backup', 'restore'];

// Process.argv are expected like 
//   path-of-node path-of-js (restore|backup)...
// So, the second argument should be action name.
const OPTIONS = {};
READ_OPTIONS: {
    const def = {
        groups: [
            [ '--help -h [0:=*help] REQUIRED' ],
            [ 
                '--aws --aws-config NOT NULL REQUIRED',
                '--bucket NOT NULL REQUIRED', 
                '--prefix NOT NULL',
                '--directory NOT NULL REQUIRED',
                '--mapper NOT NULLABLE',
                '--filter NOT NULLABLE',
                '--dual-meta-filter NOT NULLABLE',
                '--retry',
                '--start-over NOT ASSIGNABLE',
                '--force NOT ASSIGNABLE',
                '--fill NOT ASSIGNABLE',
                '--concurrency --co NOT NULL DEFAULT(10)',
            ]
        ],
        explicit: true,
        catcher: (err) => {
            console.error(err.message);
            console.log('Run "s3-tune --help" to see detailed help info.');
            process.exit(1);
        }
    };
    
    let args = process.argv.slice(2);
    if (ACTIONS.includes(args[0])) {
        OPTIONS.action = args.shift();
    }
    Object.assign(OPTIONS, commandos.parse.onlyArgs(args, def));
}

if (OPTIONS.help) {
    console.log(noda.inRead('help.txt', 'utf8'));
    process.exit(0);
}

if (!OPTIONS.action) {
    console.error(`action should be one of "${ACTIONS.join(', ')}"`);
    console.log('Run "s3-tune --help" to see detailed help info.');
    process.exit(1);
}

if (OPTIONS.retry === true) {
    OPTIONS.retry = 3;
}
else {
    OPTIONS.retry = parseInt(OPTIONS.retry);
}

const syncOptions = { 
    s3          : null,
    bucket      : OPTIONS.bucket,
    retry       : OPTIONS.retry,
    maxCreating : OPTIONS.concurrency,
    prefix      : OPTIONS.prefix,
    // , ... 注意：下面还有！ 
};

// 为了实现可续传，我们需要一串包含描述该任务内容的实质性参数（影响该任务的结果，而非过程）。
// 这些参数将构成任务的 taskId 。
const taskIdMeta = {
    action     : OPTIONS.action,
    aws        : null,
    bucket     : OPTIONS.bucket,
    directory  : null,
};

VERIFY_AWS_CONFIG: {
    let pathname = path.resolve(OPTIONS.aws);
    if (!fs.existsSync(pathname)) {
        console.error('aws config file is not found:', pathname);
        process.exit(1);
    }

    let config;
    try {
        config = JSON.parse(fs.readFileSync(pathname));
    } catch (error) {
        console.error('aws config file is not valid JSON:', pathname);
        process.exit(1);
    }

    taskIdMeta.s3 = config;
    syncOptions.s3 = new AWS.S3(config);
}

VERIFY_DIRECTORY: {
    let pathname = path.resolve(OPTIONS.directory);
    let exists = fs.existsSync(pathname);
    let isdir = exists ? fs.statSync(pathname).isDirectory() : false;
    if (OPTIONS.action == 'restore') {
        if (!exists) {
            console.error('directory is not found:', pathname);
            process.exit(1);
        }
        if (!isdir) {
            console.error(pathname, 'is not a directory');
            process.exit(1);
        }
    }
    
    if (OPTIONS.action == 'backup') {
        if (exists && !OPTIONS.force) {
            console.error('directory already exists, use --force to overwrite');
            process.exit(1);
        }

        // Remove the obstacle file firstly.
        if (exists && !isdir) {
            fs.unlinkSync(pathnae);
        }
    }

    taskIdMeta.directory = pathname;
    syncOptions.directory = pathname;
}

// ---------------------------
// Main Process.

LOAD_OUTER_MODULES: {
    [ 'mapper', 'filter', 'dual-meta-filter' ].forEach(name => {
        if (!OPTIONS[name]) return;

        let camelCaseName = name.replace(/-./g, s => s.slice(1).toUpperCase());
        let pathname = path.resolve(OPTIONS[name]);
        
        let fn;
        try {
            fn = require(pathname);
        } catch(ex) {
            console.error(`failed to load ${name} module: ${pathname}`);
            console.error('--------');
            console.error(ex);
            process.exit(1);
        }
    
        if (typeof fn != 'function') {
            console.error(`${name} should be a function: ${pathname}`);
            process.exit(1);
        }

        syncOptions[camelCaseName] = fn;
        taskIdMeta[name] = fn.toString();
    });     
}

// Transform the task id object to an MD5 string.
const taskId = crypto.createHash('md5').update(JSON.stringify(taskIdMeta)).digest('hex');

// Get task data from user profile.
let commandHomepath = path.join(os.homedir(), '.s3-tune');
let taskLogHomepath = path.join(commandHomepath, taskId);
let taskJF = new JsonFile(path.join(taskLogHomepath, 'task.json'));
let taskDir = new Directory(taskLogHomepath);
let logpath = {
    success : 'success.log', 
    error   : 'error.log',
    ignore  : 'ignore.log',
    skipped : 'skipped.log',
    'no-utf8-filename' : 'no-utf8-filename.log',
};

// require('../backup')
// require('../restore')
let runner = noda.inRequire(`${OPTIONS.action}`);

if (!OPTIONS['start-over'] && !OPTIONS.fill) {
    syncOptions.marker = taskJF.json.marker;
}

// 补遗。
if (OPTIONS.fill) {
    // 从日志及日志备份中读取所有被忽略（同步失败）的对象名，并合为一处。
    let lines = '';
    [ 'ignore.log', 'ignore.bak' ].forEach(name => {
        if (taskDir.exists(name)) {
            lines += taskDir.read(name, 'utf8');
        }        
    });
    lines = uniq(sort(lines.split(NL))).filter(name => name !== '');
    
    // 备份。
    // 若命令执行中断，下次补遗操作仍将尝试全部记录。
    taskDir.write('ignore.bak', lines.join(NL));

    // 删除日志。
    taskDir.rmfr('ignore.log');

    syncOptions.names = lines;
}

let progress = runner(syncOptions);

console.log(`logs in ${taskLogHomepath}`);
console.log('-- START --');

let log = cloneObject(logpath, (name, pathname) => [ name, taskDir.open(pathname, 'a') ] );

progress.on('created', (obj) => {
    console.log('[ CREATED ]', obj.name);
    fs.writeSync(log.success, NL + obj.name);
});

progress.on('moveon', (marker) => {
    if (OPTIONS.fill) return;

    console.log('[ MOVEON  ]', marker);
    taskJF.json.marker = marker;
    taskJF.save();
});

progress.on('ignored', (obj) => {
    console.log('[ IGNORED ]', obj.name);
    fs.writeSync(log.ignore, NL + obj.name);
});

progress.on('skipped', (obj) => {
    console.log('[ SKIPPED ]', obj.name);
    fs.writeSync(log.skipped, NL + obj.name);
});

progress.on('no-utf8-filename', (obj) => {
    let posname = obj.dirname + ':' + obj.filenameBuffer.toString('hex');
    console.log('[ NO-UTF8-FILENAME ]', posname);
    fs.writeSync(log['no-utf8-filename'], NL + posname);
});

progress.on('warning', (err) => {
    console.log('[ WARNING ]', err.toString());
    fs.writeSync(log.error, NL + err.message);
});

progress.on('error', (err) => {
    console.log('[ ERROR   ]', err.toString());
    fs.writeSync(log.error, NL + err.message);
});

progress.on('end', (meta) => {
    console.log('-- END --');
    console.log(`total ${meta.created} created and ${meta.ignored} ignored`);
    console.log(`more logs in ${taskLogHomepath}`);

    // 删除日志备份。
    if (OPTIONS.fill) {
        taskDir.rmfr('ignore.bak');
    }
});
