/**
 * Created by claudio on 2019-11-26
 */

// Module variables
//

// References to external code
//
// Internal node modules
//import util from 'util';
// Third-party node modules
import resError from 'restify-errors';
import ctnOffChainLib from 'catenis-off-chain-lib';

// References code in other (Catenis Off-Chain Server) modules
import {CtnOCSvr} from './CtnOffChainSvr.js';
import {IpfsRepo} from './IpfsRepo.js';


// Definition of module (private) functions
//

// Method used to process POST '/msg-data/envelope' endpoint of REST API
//
//  JSON payload: {
//    "data': [String], Off-Chain message envelope data as a base64-encoded binary stream
//    "immediateRetrieval": [Boolean] (optional, default: false) Indicates whether saved off-chain message envelope
//                                     should be immediately retrieved
//  }
//
//  Success data returned: {
//    "status": "success",
//    "data": {
//      "cid": [String], IPFS CID of the saved off-chain message envelope
//      "savedDate": [String] ISO-8601 formatted date and time when off-chain message envelope has been saved
//    }
//  }
//
export function saveOffChainMsgEnvelope(req, res, next) {
    (async () => {
        if (res.claimUpgrade) {
            return new resError.ForbiddenError('Endpoint does not allow for connection upgrade');
        }

        if (!this.canProcess()) {
            return new resError.ServiceUnavailableError('Service unavailable');
        }

        if (req.getContentType() !== 'application/json') {
            return new resError.UnsupportedMediaTypeError('Unsupported media type');
        }

        if (!(typeof req.body === 'object' && req.body !== null)) {
            return new resError.BadRequestError('Missing body parameters');
        }

        const bufMsgEnvelope = validateOffChainMsgEnvelope(req.body.data);

        if (!bufMsgEnvelope) {
            return new resError.BadRequestError('Missing or invalid body parameters');
        }

        const retrieveImmediately = !!req.body.immediateRetrieval;

        // Save off-chain message data onto IPFS repository
        const saveResult = await CtnOCSvr.ipfsRepo.saveOffChainMsgData(bufMsgEnvelope, IpfsRepo.offChainMsgDataRepo.msgEnvelope, retrieveImmediately);

        res.send({
            status: 'success',
            data: saveResult
        });
    })()
    .then(result => {
        next(result);
    }, err => {
        CtnOCSvr.logger.ERROR('Error processing POST \'/msg-data/envelope\' API request.', err);
        return next(new resError.InternalServerError('Internal server error'));
    });
}

function validateOffChainMsgEnvelope(data) {
    if (typeof data === 'string') {
        let msgEnvelope;
        let bufData;

        try {
            bufData = Buffer.from(data, 'base64');
            msgEnvelope = ctnOffChainLib.MessageEnvelope.fromBuffer(bufData);
        }
        catch (err) {
            CtnOCSvr.logger.DEBUG('saveOffChainMsgEnvelope: `data` body parameter is not a valid Catenis off-chain message envelope');
        }

        if (msgEnvelope) {
            if (msgEnvelope.isSigned) {
                if (msgEnvelope.verifySignature()) {
                    return bufData;
                }
                else {
                    CtnOCSvr.logger.DEBUG('saveOffChainMsgEnvelope: `data` body parameter contains a Catenis off-chain message envelope with an invalid signature');
                }
            }
            else {
                CtnOCSvr.logger.DEBUG('saveOffChainMsgEnvelope: `data` body parameter contains a Catenis off-chain message envelope that is not signed');
            }
        }
    }
    else {
        CtnOCSvr.logger.DEBUG('saveOffChainMsgEnvelope: invalid type of `data` body parameter [%s]', data);
    }

    return false;
}
