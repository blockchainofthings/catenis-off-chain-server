/**
 * Created by claudio on 2019-11-21
 */

// Module variables
//

// References to external code
//
// Internal node modules
//import util from 'util';
// Third-party node modules
import config from 'config';
import Future from 'fibers/future';
import moment from 'moment';
import async from 'async';

// References code in other (Catenis Name Server) modules
import {CtnOCSvr} from './CtnOffChainSvr';
import {CriticalSection} from './CriticalSection';
import {formatNumber} from './Util';

// Config entries
const ipfsRepoConfig = config.get('ipfsRepo');

// Configuration settings
const cfgSettings = {
    rootDir: ipfsRepoConfig.get('rootDir'),
    saveRootCidInterval: ipfsRepoConfig.get('saveRootCidInterval'),
    retrieveRootCidsInterval: ipfsRepoConfig.get('retrieveRootCidsInterval'),
    retrieveRootCidsWaitTimeout: ipfsRepoConfig.get('retrieveRootCidsWaitTimeout'),
    cnsTimeDelay: ipfsRepoConfig.get('cnsTimeDelay')
};


// Definition of function classes
//

// IpfsRepo function class
export function IpfsRepo(ipfsClient) {
    this.ipfsClient = ipfsClient;

    // Critical section object used to serialize save data requests
    this.saveCS = new CriticalSection();

    try {
        initRootCid.call(this);
    }
    catch (err) {
        CtnOCSvr.logger.ERROR('Error initializing IPFS repository root CID.', err);
        throw new Error('Error initializing IPFS repository root CID');
    }

    this.savingRootCid = false;
    this.retrievingRootCids = false;
    this.boundRetrieveOffChainMsgData = retrieveOffChainMsgData.bind(this);
    this.futTurnAutomationOff = undefined;
    this.automationOn = false;

    if (!CtnOCSvr.app.isTest) {
        this.turnAutomationOn();
    }
    else {
        // Running tests. Do not turn automation on but give access to internal
        //  methods used by the automation instead
        this.boundSaveRootCid = saveRootCid.bind(this);
        this.boundRetrieveRootCids = retrieveRootCids.bind(this);
        this.boundScanRepoPath = scanRepoPath.bind(this);
    }
}


// Public IpfsRepo object methods
//

IpfsRepo.prototype.turnAutomationOn = function () {
    if (!this.automationOn) {
        // Set recurring timer to save IPFS repository root CID onto CNS
        this.saveRootCidInterval = setInterval(saveRootCid.bind(this), cfgSettings.saveRootCidInterval);

        // Set recurring timer to retrieve updated IPFS repository root CIDs from CNS
        this.retrieveRootCidsWaitTimeout = setTimeout(() => {
            this.retrieveRootCidsWaitTimeout = undefined;
            this.retrieveRootCidsInterval = setInterval(retrieveRootCids.bind(this), cfgSettings.retrieveRootCidsInterval);
        }, cfgSettings.retrieveRootCidsWaitTimeout);

        // Indicate that IPFS repository automation is on
        this.automationOn = true;
        CtnOCSvr.app.setIpfsRepoAutomationOn();
    }
};

IpfsRepo.prototype.turnAutomationOff = function () {
    if (this.automationOn) {
        // Stop recurring timers
        clearInterval(this.saveRootCidInterval);
        this.saveRootCidInterval = undefined;

        if (this.retrieveRootCidsInterval) {
            clearInterval(this.retrieveRootCidsInterval);
            this.retrieveRootCidsInterval = undefined;
        }
        else {
            clearTimeout(this.retrieveRootCidsWaitTimeout);
            this.retrieveRootCidsWaitTimeout = undefined;
        }

        // Now give it a chance to finish any pending processing
        if (this.savingRootCid) {
            // Already saving root CID. Wait for it to finish
            this.futTurnAutomationOff = new Future();

            this.futTurnAutomationOff.wait();
            this.futTurnAutomationOff = undefined;
        }

        if (this.retrievingRootCids) {
            // Already retrieving root CIDs. Wait for it to finish
            this.futTurnAutomationOff = new Future();

            this.futTurnAutomationOff.wait();
            this.futTurnAutomationOff = undefined;
        }

        saveRootCid.call(this, (err) => {
            if (err) {
                if (err) {
                    CtnOCSvr.logger.ERROR('Error while saving IPFS repository root CID onto CNS.', err);
                }

                this.savingRootCid = false;

                retrieveRootCids.call(this, (err) => {
                    if (err) {
                        CtnOCSvr.logger.ERROR('Error while retrieving updated IPFS repository root CIDs.', err);
                    }

                    this.retrievingRootCids = false;

                    // Indicate that automation is off
                    this.automationOn = false;
                    CtnOCSvr.app.setIpfsRepoAutomationOff();
                });
            }
        });
    }
};

IpfsRepo.prototype.saveOffChainMsgData = function (data, dataType, refDate) {
    // Execute code in critical section to serialize calls
    this.saveCS.execute(() => {
        const mtRefDate = moment(refDate).utc();

        if (!mtRefDate.isValid()) {
            throw new TypeError('saveOffChainMsgData: invalid `refDate` argument');
        }

        // Build path according to reference date
        const basePath = cfgSettings.rootDir + IpfsRepo.repoSubtype.offChainMsgData.subDir
            + mtRefDate.format(IpfsRepo.repoSubtype.offChainMsgData.pathFormat) + dataType.subDir + '/' + dataType.filenamePrefix
            + formatNumber(millisecondsInMinute(mtRefDate), 5);

        // Make sure that filename does not yet exists
        let microSecs = 0;
        let path;
        let rootStat;

        do {
            path = basePath + formatNumber(microSecs++, 3);
            rootStat = undefined;

            try {
                rootStat = this.ipfsClient.filesStat(path, {hash: true}, false);
            }
            catch (err) {
                if (err._ipfsError instanceof Error) {
                    // IPFS client error
                    if (err._ipfsError.message !== 'file does not exist') {
                        // An error other than one that indicates that path does not exist.
                        //  Log error and rethrow it
                        CtnOCSvr.logger.DEBUG(err.message, err._ipfsError);
                        throw err;
                    }
                }
                else {
                    // Any other error. Just rethrow it
                    throw err;
                }
            }
        }
        while (rootStat && microSecs < 1000);

        if (rootStat && microSecs > 1000) {
            // Maximum number of files with the same timestamp exceeded. Throw error
            throw new Error('Maximum number of files with the same timestamp exceeded');
        }

        // Write to IPFS
        this.ipfsClient.filesWrite(path, data, {
            create: true,
            parents: true
        });

        // Retrieve updated repository root CID
        this.rootCid = this.ipfsClient.filesStat(cfgSettings.rootDir, {hash: true}).hash;
    });
};

IpfsRepo.prototype.listRetrievedOffChainMsgData = function (retrievedAfter, limit, skip) {
    const query = {};
    const options = {
        projection: {
            cid: 1,
            data: 1,
            dataType: 1,
            retrievedDate: 1
        }
    };

    if (retrievedAfter) {
        query.retrievedDate = {$gt: retrievedAfter};
    }

    if (limit) {
        options.limit = limit + 1;
    }

    if (skip) {
        options.skip = skip;
    }

    const retDocs = CtnOCSvr.db.collection.RetrievedOffChainMsgData.find(query, options);

    if (retDocs.length > 0) {
        const result = {
            dataItems: undefined,
            hasMore: false
        };

        if (limit && retDocs.length > limit) {
            result.hasMore = true;
            retDocs.pop();
        }

        result.dataItems = retDocs.map(doc => {
            return {
                cid: doc.cid,
                data: Buffer.from(doc.data.buffer),
                dataType: doc.dataType,
                retrievedDate: doc.retrievedDate
            };
        });

        return result;
    }
};


// Module functions used to simulate private IpfsRepo object methods
//  NOTE: these functions need to be bound to a IpfsRepo object reference (this) before
//      they are called, by means of one of the predefined function methods .call(), .apply()
//      or .bind().
//

function initRootCid() {
    this.rootCid = undefined;
    this.lastSavedRootCid = undefined;

    // Retrieve repository root CID last saved to CNS
    const data = CtnOCSvr.cns.getIpfsRepoRootCid();

    if (data) {
        this.lastSavedRootCid = data.cid;
    }

    // Try to retrieve repository root CID from IPFS node
    let rootStat;

    try {
        rootStat = this.ipfsClient.filesStat(cfgSettings.rootDir, {hash: true}, false);
    }
    catch (err) {
        if (err._ipfsError instanceof Error) {
            // IPFS client error
            if (err._ipfsError.message !== 'file does not exist') {
                // An error other than one that indicates that path does not exist.
                //  Log error and rethrow it
                CtnOCSvr.logger.DEBUG(err.message, err._ipfsError);
                throw err;
            }
        }
        else {
            // Any other error. Just rethrow it
            throw err;
        }
    }

    if (rootStat) {
        this.rootCid = rootStat.hash;
    }
    else if (this.lastSavedRootCid) {
        // Repository root CID not found in IPFS node. Set it to last saved value
        this.ipfsClient.filesCp('ipfs/' + this.lastSavedRootCid, cfgSettings.rootDir);
        this.rootCid = this.lastSavedRootCid;
    }
    else {
        // Repository root CID not found in IPFS node, and no value is saved to CNS.
        //  Define new root
        this.ipfsClient.filesMkdir(cfgSettings.rootDir);
        this.rootCid = this.ipfsClient.filesStat(cfgSettings.rootDir, {hash: true}).hash;
    }
}

function saveRootCid(callback) {
    if (!this.savingRootCid) {
        this.savingRootCid = true;

        if (typeof callback !== 'function') {
            callback = (err) => {
                if (err) {
                    CtnOCSvr.logger.ERROR('Error while saving IPFS repository root CID onto CNS.', err);
                }

                this.savingRootCid = false;
            };
        }

        // Make sure that code runs in its own fiber
        Future.task(() => {
            // Check if root CID needs to be saved
            if (this.rootCid !== this.lastSavedRootCid) {
                const rootCid = this.rootCid;

                // Pin root CID (and all its subdirectories) before saving it
                if (this.lastSavedRootCid) {
                    this.ipfsClient.pinUpdate(this.lastSavedRootCid, rootCid);
                }
                else {
                    this.ipfsClient.pinAdd(rootCid);
                }

                // Now, save it onto CNS
                CtnOCSvr.cns.setIpfsRepoRootCid(rootCid);
                this.lastSavedRootCid = rootCid;
            }
        }).resolve(callback);
    }
}

function retrieveRootCids(callback) {
    if (!this.retrievingRootCids) {
        this.retrievingRootCids = true;

        if (typeof callback !== 'function') {
            callback = (err) => {
                if (err) {
                    CtnOCSvr.logger.ERROR('Error while retrieving updated IPFS repository root CIDs.', err);
                }

                this.retrievingRootCids = false;
            };
        }

        // Make sure that code runs in its own fiber
        Future.task(() => {
            const refDate = new Date();

            // Retrieve updated IPFS repository root CIDs
            let updatedSince;

            if (CtnOCSvr.app.lastIpfsRepoRootCidsRetrievalDate) {
                updatedSince = moment(CtnOCSvr.app.lastIpfsRepoRootCidsRetrievalDate).subtract(cfgSettings.cnsTimeDelay, 'ms').toDate();
            }

            const ipfsRepoRootCids = CtnOCSvr.cns.getAllIpfsRepoRootCids(updatedSince);

            if (ipfsRepoRootCids) {
                // Add reference date to each returned repo root
                Object.values(ipfsRepoRootCids).forEach(repoRoot => repoRoot.refDate = refDate);

                // Retrieve off-chain message data from IPFS repository of each Catenis node
                const fut = new Future();

                async.eachOf(ipfsRepoRootCids, this.boundRetrieveOffChainMsgData, fut.resolver());

                fut.wait();
            }

            // Update IPFS repository root CIDs retrieval date
            CtnOCSvr.app.lastIpfsRepoRootCidsRetrievalDate = refDate;
        }).resolve(callback);
    }
}

function retrieveOffChainMsgData(repoRoot, ctnNodeIdx, callback) {
    try {
        const docIpfsRepoScan = CtnOCSvr.db.collection.IpfsRepoScan.findOne({
            ctnNodeIdx: ctnNodeIdx,
            repoSubtype: IpfsRepo.repoSubtype.offChainMsgData.name
        }, {
            projection: {
                _id: 1,
                lastScannedPath: 1,
                lastScannedFiles: 1
            }
        });

        const lastScannedPath = docIpfsRepoScan ? docIpfsRepoScan.lastScannedPath : undefined;
        const scannedPaths = scanRepoPath.call(this, IpfsRepo.repoSubtype.offChainMsgData, repoRoot.cid, lastScannedPath);

        if (scannedPaths.length > 0) {
            const lastScannedOffChainMsgEnvelope = docIpfsRepoScan ? docIpfsRepoScan.lastScannedFiles.offChainMsgData.envelope : null;
            const lastScannedOffChainMsgReceipt = docIpfsRepoScan ? docIpfsRepoScan.lastScannedFiles.offChainMsgData.receipt : null;
            let lastMsgEnvelope;
            let lastMsgReceipt;

            // noinspection DuplicatedCode
            scannedPaths.forEach((path, idx) => {
                // Scan off-chain message envelope files in path
                lastMsgEnvelope = null;
                let fileEntries;

                try {
                    fileEntries = this.ipfsClient.ls(path + IpfsRepo.offChainMsgDataType.msgEnvelope.subDir, false);
                }
                catch (err) {
                    if (err._ipfsError instanceof Error) {
                        // IPFS client error
                        if (!/^no link named ".+" under /.test(err._ipfsError.message)) {
                            // An error other than one that indicates that path does not exist.
                            //  Log error and rethrow it
                            CtnOCSvr.logger.DEBUG(err.message, err._ipfsError);
                            throw err;
                        }
                    }
                    else {
                        // Any other error. Just rethrow it
                        throw err;
                    }
                }

                if (fileEntries) {
                    if (idx === 0 && lastScannedOffChainMsgEnvelope) {
                        fileEntries = fileEntries.filter(fileEntry => fileEntry.name > lastScannedOffChainMsgEnvelope);
                    }

                    const maxFileEntriesIdx = fileEntries.length - 1;

                    fileEntries.forEach((fileEntry, idx) => {
                        // Retrieve off-chain message envelope contents
                        const msgEnvelopeData = this.ipfsClient.cat(fileEntry.hash);

                        // Save retrieved off-chain message envelope
                        CtnOCSvr.db.collection.RetrievedOffChainMsgData.insert({
                            cid: fileEntry.hash,
                            data: new Uint8Array(msgEnvelopeData),  // NOTE: convert Buffer object into a TypedArray so the data is stored as a binary stream
                            dataType: IpfsRepo.offChainMsgDataType.msgEnvelope.name,
                            retrievedDate: repoRoot.refDate
                        });

                        if (idx === maxFileEntriesIdx) {
                            lastMsgEnvelope = fileEntry.name;
                        }
                    });
                }

                // Scan off-chain message receipt files in path
                lastMsgReceipt = null;
                fileEntries = undefined;

                try {
                    fileEntries = this.ipfsClient.ls(path + IpfsRepo.offChainMsgDataType.msgReceipt.subDir, false);
                }
                catch (err) {
                    if (err._ipfsError instanceof Error) {
                        // IPFS client error
                        if (!/^no link named ".+" under /.test(err._ipfsError.message)) {
                            // An error other than one that indicates that path does not exist.
                            //  Log error and rethrow it
                            CtnOCSvr.logger.DEBUG(err.message, err._ipfsError);
                            throw err;
                        }
                    }
                    else {
                        // Any other error. Just rethrow it
                        throw err;
                    }
                }

                if (fileEntries) {
                    if (idx === 0 && lastScannedOffChainMsgReceipt) {
                        fileEntries = fileEntries.filter(fileEntry => fileEntry.name > lastScannedOffChainMsgReceipt);
                    }

                    const maxFileEntriesIdx = fileEntries.length - 1;

                    fileEntries.forEach((fileEntry, idx) => {
                        // Retrieve off-chain message receipt contents
                        const msgReceiptData = this.ipfsClient.cat(fileEntry.hash);

                        // Save retrieved off-chain message receipt
                        CtnOCSvr.db.collection.RetrievedOffChainMsgData.insert({
                            cid: fileEntry.hash,
                            data: new Uint8Array(msgReceiptData),  // NOTE: convert Buffer object into a TypedArray so the data is stored as a binary stream
                            dataType: IpfsRepo.offChainMsgDataType.msgReceipt.name,
                            retrievedDate: repoRoot.refDate
                        });

                        if (idx === maxFileEntriesIdx) {
                            lastMsgReceipt = fileEntry.name;
                        }
                    });
                }
            });

            // Check if IPFS repo scan info needs to be saved/updated
            CtnOCSvr.logger.DEBUG('>>>>>> Check if IPFS repo scan info needs to be saved/updated:', {
                lastScannedPath: lastScannedPath,
                'scannedPaths.length': scannedPaths.length,
                lastMsgEnvelope: lastMsgEnvelope,
                lastMsgReceipt: lastMsgReceipt
            });
            if (!lastScannedPath || scannedPaths.length > 1 || lastMsgEnvelope || lastMsgReceipt) {
                const subtypeRootPath = repoRoot.cid + IpfsRepo.repoSubtype.offChainMsgData.subDir;

                if (!docIpfsRepoScan) {
                    // Insert new IPFS repo scan database doc
                    CtnOCSvr.logger.DEBUG('>>>>>> Insert new IPFS repo scan database doc');
                    CtnOCSvr.db.collection.IpfsRepoScan.insert({
                        ctnNodeIdx: ctnNodeIdx,
                        repoSubtype: IpfsRepo.repoSubtype.offChainMsgData.name,
                        lastScannedPath: scannedPaths[scannedPaths.length - 1].substring(subtypeRootPath.length),
                        lastScannedFiles: {
                            offChainMsgData: {
                                envelope: lastMsgEnvelope,
                                receipt: lastMsgReceipt
                            }
                        }
                    });
                }
                else {
                    // Update IPFS repo scan database doc
                    CtnOCSvr.logger.DEBUG('>>>>>> Update IPFS repo scan database doc');
                    const fieldsToUpdate = {
                        lastScannedPath: scannedPaths[scannedPaths.length - 1].substring(subtypeRootPath.length)
                    };

                    if (lastMsgEnvelope !== lastScannedOffChainMsgEnvelope) {
                        fieldsToUpdate['lastScannedFiles.offChainMsgData.envelope'] = lastMsgEnvelope;
                    }

                    if (lastMsgReceipt !== lastScannedOffChainMsgReceipt) {
                        fieldsToUpdate['lastScannedFiles.offChainMsgData.receipt'] = lastMsgReceipt;
                    }

                    CtnOCSvr.db.collection.IpfsRepoScan.update({
                        _id: docIpfsRepoScan._id
                    }, {
                        $set: fieldsToUpdate
                    });
                }
            }
        }

        process.nextTick(callback);
    }
    catch (err) {
        process.nextTick(callback, err);
    }
}

function scanRepoPath(repoSubtype, rootCid, lastScannedPath) {
    const subtypeRootPath = rootCid + repoSubtype.subDir;
    let lastPathLevels = [];

    if (lastScannedPath) {
        lastPathLevels = lastScannedPath.split('/').filter(s => s.length > 0);

        // Add root path to last scanned path
        lastScannedPath = subtypeRootPath + lastScannedPath;
    }

    const scannedPaths = [];

    const scan = (path, level) => {
        if (level > repoSubtype.pathDepth) {
            scannedPaths.push(path);
        }
        else {
            let dirEntries = this.ipfsClient.ls(path, false);

            if (lastScannedPath && lastScannedPath.startsWith(path)) {
                // Accept only dirs that are newer than last level dir
                dirEntries = dirEntries.filter(dirEntry => dirEntry.name >= lastPathLevels[level - 1]);
            }

            dirEntries.forEach(dirEntry => scan(path + '/' + dirEntry.name, level + 1));
        }
    };
    
    try {
        scan(subtypeRootPath, 1);
    }
    catch (err) {
        if (err._ipfsError instanceof Error) {
            // IPFS client error
            if (!/^no link named ".+" under /.test(err._ipfsError.message)) {
                // An error other than one that indicates that path does not exist.
                //  Log error and rethrow it
                CtnOCSvr.logger.DEBUG(err.message, err._ipfsError);
                throw err;
            }
        }
        else {
            // Any other error. Just rethrow it
            throw err;
        }
    }
    
    return scannedPaths;
}


// IpfsRepo function class (public) methods
//

IpfsRepo.initialize = function () {
    CtnOCSvr.logger.TRACE('IpfsRepo initialization');
    CtnOCSvr.ipfsRepo = new IpfsRepo(CtnOCSvr.ipfsClient);
};


// IpfsRepo function class (public) properties
//

IpfsRepo.repoSubtype = Object.freeze({
    offChainMsgData: Object.freeze({
        name: 'off-chain-msg-data',
        description: 'Portion of the IPFS repository used to store data related to Catenis off-chain messages',
        subDir: '/msgs',
        pathDepth: 5,
        pathFormat: '/YYYY/MM/DD/HH/mm'
    })
});

IpfsRepo.offChainMsgDataType = Object.freeze({
    msgEnvelope: Object.freeze({
        name: 'msg-envelope',
        description: 'Off-Chain message envelope',
        subDir: '/msg',
        filenamePrefix: 'msg-'
    }),
    msgReceipt: Object.freeze({
        name: 'msg-receipt',
        description: 'Off-Chain message receipt',
        subDir: '/rcpt',
        filenamePrefix: 'rcpt-'
    })
});


// Definition of module (private) functions
//

function millisecondsInMinute(mt) {
    return mt.second() * 1000 + mt.millisecond();
}


// Module code
//
