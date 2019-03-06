'use strict';

const MODULE_REQUIRE = 1
    /* built-in */
    , fs = require('fs')
    , path = require('path')
    , util = require('util')

    , fsReadFile = util.promisify(fs.readFile)
    , fsReaddir = util.promisify(fs.readdir)
    , fsStat = util.promisify(fs.stat)
    
    /* NPM */
    , mime = require('mime')
    , noda = require('noda')
    , Progress = require('jinang/Progress')
    , cloneObject = require('jinang/cloneObject')
    , sleep = require('jinang/sleep')
    
    /* in-package */
    , Marker = noda.inRequire('class/Marker')

    /* in-file */
    ;

/**
 * @param  {object}     options.s3                 instance of AWS.S3
 * @param  {string}     options.bucket             bucket name
 * @param  {string}     options.directory          directory in local file system
 * @param  {string[]}  [options.names]             object names to be synchronised
 * @param  {Function}  [options.mapper]            object names mapper
 * @param  {Function}  [options.filter]            object names filter
 * @param  {Function}  [options.dualMetaFilter]    object metainfos (both local and remote) filter
 * @param  {number}    [options.maxCreated]        maximum creation allowed (the progress will be terminated)
 * @param  {number}    [options.maxCreating]       maximum cocurrent creating operation allowed
 * @param  {number}    [options.maxQueueing]       maximum queue length allowed  
 * @param  {number}    [options.maxErrors]         maximum exceptions allowed (the progress will be terminated)
 * @param  {number}    [options.retry]             maximum retry times on exception for each object
 * 
 * @return EventEmitter
 */
function restore(options) {
    // 指代整个同步过程。
    const progress = new Progress();

    // ---------------------------
    // Uniform & validate arguments.

    const s3 = options.s3;

    options = Object.assign({
        maxCreating : 3,
        maxCreated  : Number.MAX_SAFE_INTEGER,
        maxQueueing : 1000,
        maxErrors   : Number.MAX_SAFE_INTEGER,
        retry       : 3,
    }, options);

    if (typeof options.retry != 'number' || isNaN(options.retry)) {
        options.retry = 0;
    }
    
    // ---------------------------
    // Flags.
    
    let 
        // 标记为真时，停止添加新的对象到待创建队列中。
        stopRegister = false, 

        // 标记为真时，停止创建新的对象（已发起创建操作的对象不受影响），即使待创建队列不为空。
        stopCreate = false,

        // 在所有对象均已添加到待创建队列后（注册完毕），标记为真。
        registerFinished = false;
    
    // 收到 QUIT 信号时：
    // * 将“停止注册”标记为 TRUE
    progress.signal(Progress.SIGQUIT, () => {
        stopRegister = true;
    });

    // 收到 ABORT 信号时：
    // * 将“停止注册”标记为 TRUE
    // * 将“停止创建”标记为 TRUE
    progress.signal(Progress.SIGABRT, () => {
        stopRegister = true;
        stopCreate = true;
    });

    // 上次同步点。
    let marker = new Marker(options.marker);

    const STATUS_NAMES = [ 'waiting', 'creating', 'created', 'ignored', 'skipped' ];

    // 队列。
    const queue = {
        // 等待同步的文件列表：[ [keyName, pathname] ]
        waiting: [],

        // 未归档的同步文件状态列表：[ [ keyName, 0 (waiting) | 1 (creating) | 2 (created) | 3 (ignored) | 4 (skipped) ] ]
        // ignored 状态表示文件应某种故障未同步成功；
        // skipped 状态表示文件被过滤器（filter | metaFilter | dualMetaFilter）禁止同步。
        unarchived: [],

        // { 对象名 : 重试次数 }
        retry: {},
    };

    // 计数器。
    const counter = {
        // 在同步中的文件数目。
        creating: 0,

        // 已登记（包含不同同步状态）的文件数量。
        registered: 0,

        // 同步失败次数。
        errors: 0,

        // 创建（同步）成功的文件数目。
        created: 0,

        // 忽略（同步失败）的文件数目。
        ignored: 0,
    };

    // 触发 error / end 事件时，附带的统计数据。
    const genReturnMeta = () => Object.assign(
        {}, 
        cloneObject(counter, [ 'errors', 'created', 'ignored' ])
    );

    // ---------------------------
    // Main process.
    
    // 执行创建操作。
    // 在存储中创建对象。
    const s3PutObject = util.promisify(s3.putObject.bind(s3));
    const s3ReadMeta = util.promisify(callback => {
        s3.headObject({ Bucket, Key }, (err, data) => {
            if (err && err.statusCode == 404) callback(null, null);
            else callback(err, data);
        });
    });

    const create = async (keyName, pathname) => {
        const Bucket = options.bucket;
        const Key = options.mapper ? options.mapper(keyName) : keyName;
        const ContentType = mime.getType(Key);       

        if (options.filter && !options.filter(keyName)) {
            return 4; // 4 means skipped
        }

        if (options.dualMetaFilter) {
            let stat = await fsStat(pathname);
            let meta = await s3ReadMeta();
            if (!options.dualMetaFilter(stat, meta)) {
                return 4; // 4 means skipped
            }
        }

        let buf = await fsReadFile(pathname);
        await s3PutObject({ Bucket, Key, ContentType, Body: buf });
        return 2;
    };

    // 调度队列，尝试执行下一个创建操作。
    const next = () => {
        if (stopCreate) {
            return false;
        }

        if (counter.creating >= options.maxCreating) {
            return false;
        }
        else if (queue.waiting.length == 0) {
            return false;
        }
        else {
            let item = queue.waiting.shift();
            let keyName = item[0], pathname = item[1];

            // 更新同步状态。
            let itemInUnarchived = queue.unarchived.find((q) => q[0] == keyName);
            itemInUnarchived[1] = 1;

            counter.creating++;
            create(keyName, pathname)
                .then(status => archive(keyName, status))
                .catch(err => on_create_error(err, keyName, pathname))
                .then(() => {
                    counter.creating--;
                    next();
                });
            return true;
        }
    };

    const on_create_error = (err, keyName, pathname) => {
        // 判断是否允许重试。
        if (queue.retry[keyName]) {
            // 如果已达最大重试次数，则忽略该对象并标记。
            // 否则仅将重试次数累加。
            if (queue.retry[keyName]++ >= options.retry) {
                delete queue.retry[keyName];
            }
        }
        else if (options.retry) {
            queue.retry[keyName] = 1;
        }

        // 按重试处理。
        if (queue.retry[keyName]) {
            // 重置未归档队列中该对象的状态值。
            queue.unarchived.find((q) => q[0] == keyName)[1] = 0; // 0 := waiting

            // 放入等待队列队首，优先重试创建操作。
            queue.waiting.unshift([keyName, pathname]);
            
            // 触发警告。
            progress.emit('warning', err, genReturnMeta());
        }
        else {
            archive(keyName, 3); // 3 means ignored

            // 触发错误。
            progress.emit('error', err, genReturnMeta());
        }

        // 如果失败次数已达上限，则终止所有事务。
        if (++counter.errors >= options.maxErrors) {
            progress.abort();
            return;
        }
    };

    // 归档已创建对象。
    const archive = (keyName, status) => {
        let i = queue.unarchived.findIndex((q) => q[0] == keyName);

        let statusName = STATUS_NAMES[status];

        // 更新计数。
        // statusName := created | ignored
        counter[statusName]++;

        // 触发事件。
        progress.emit(statusName, { name: keyName });
        
        // 如果在待归档队列中未排在首位，则更新其状态。            
        if (i > 0) {
            queue.unarchived[i][1] = status;
        }
        // 否则，开始归档。
        else {
            let l = queue.unarchived.length;
            while(i+1 < l && queue.unarchived[i+1][1] >= 2) { 
                // >= 2 means created OR ignored OR skipped
                i++;
            }            
            let markup = queue.unarchived[i][0];
            queue.unarchived.splice(0, i+1);

            // 触发游标前移事件。
            progress.emit('moveon', markup);

            try_end();
        }
        
    };

    // 在队列中登记。
    const register = (keyName, pathname) => {
        // 如果当前登记项数已超过最大可创建对象数，则终止注册，并触发 QUIT 信号。
        if (counter.registered >= options.maxCreated) {
            progress.quit();
            return false;
        }
        else {
            queue.unarchived.push([ keyName, 0 ]);
            queue.waiting.push([ keyName, pathname ]);
            counter.registered++;
            next();
            return true;
        }
    };

    const on_register_finished = () => {
        registerFinished = true;
        try_end();
    };

    const try_end = () => {
        if (registerFinished && queue.unarchived.length == 0) {
            progress.emit('end', genReturnMeta());
        }
    }

    // 深度优先，遍历目录。
    let started = false;
    const run = async (dirname, parentKeyNamePieces) => { 
        // Why not fs.readdirSync() ?
        // To avoid IO blocking.
        let fsnames = await fsReaddir(dirname, 'buffer');
        fsnames.sort();

        for (let i = 0; i < fsnames.length; i++) {
            // 如果收到异常信号，则终止遍历。
            if (stopRegister) return;

            let fsname = fsnames[i].toString('utf8');
            if (!Buffer.from(fsname).equals(fsnames[i])) {
                progress.emit('no-utf8-filename', {
                    dirname: parentKeyNamePieces.join('/'),
                    filenameBuffer: fsnames[i],
                });
                continue;
            }

            let keyNamePieces = parentKeyNamePieces.concat(fsname);
            let keyName = keyNamePieces.join('/');
            
            if (marker.equal(keyName)) {
                started = true;
                continue;
            }

            // 如果尚未开始同步，则根据是否超越同步点，判断是否需要深入检查。
            if (started || !marker.cover(keyName)) {
                let realpath = path.join(dirname, fsname);

                // Why not fs.statSync() ?
                // To avoid IO blocking.
                let stats = await fsStat(realpath);
                    
                // 遇目录则递归遍历。
                if (stats.isDirectory()) {
                    await run(realpath, keyNamePieces);
                }

                // 遇文件则直接同步（上载）。
                else {
                    // 如果等候队列长度超过限度，则暂停排队。
                    while (queue.waiting.length >= options.maxQueueing) {
                        await sleep.promise(1000);
                    }
                    register(keyName, realpath);
                }
            }
        }
        if (parentKeyNamePieces.length == 0) on_register_finished();
    };
    
    process.nextTick(() => {
        if (options.names) {
            options.names.forEach(name => {
                let realpath = path.resolve(source.path, name);
                register(name, realpath);
            });
            on_register_finished();
        }
        else {
            run(options.directory, []);
        }
    });

    return progress;
}

module.exports = restore;