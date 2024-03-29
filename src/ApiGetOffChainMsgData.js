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
import config from 'config';
import resError from 'restify-errors';
import moment from 'moment';

// References code in other (Catenis Name Server) modules
import {CtnOCSvr} from './CtnOffChainSvr.js';
import {strictParseInt} from './Util.js';

// Config entries
const apiConfig = config.get('apiGetOffChainMsgData');

// Configuration settings
export const cfgSettings = {
    maxItemsCount: apiConfig.get('maxItemsCount')
};


// Definition of module (private) functions
//

// Method used to process GET '/msg-data' endpoint of REST API
//
//  Query string (optional) parameters:
//    retrievedAfter [String] ISO-8601 formatted date and time used to filter off-chain message data items that should be returned.
//                             Only off-chain message data items that have been retrieved after this date should be returned
//    limit [Number] (default: 'maxItemsCount') Maximum number of data items that should be returned
//    skip [Number] (default: 0) Number of data items that should be skipped (from beginning of list of matching data items) and not returned
//
//  Success data returned: {
//    "status": "success",
//    "data": {
//      "dataItems": [{
//        "cid": [String], IPFS CID of the off-chain message data
//        "data": [String], Off-Chain message data as a base64-encoded binary stream
//        "dataType": [String], Type of off-chain message data; either 'msg-envelope' or 'msg-receipt'
//        "savedDate": [String], ISO-8601 formatted date and time when off-chain message data has originally been saved
//        "retrievedDate": [String], ISO-8601 formatted date and time when off-chain message data has been retrieved
//      }],
//      "hasMore": [Boolean] Indicates whether there are more data items that satisfy the search criteria yet to be returned
//    }
//  }
//
export function getOffChainMsgData(req, res, next) {
    (async () => {
        if (res.claimUpgrade) {
            return new resError.ForbiddenError('Endpoint does not allow for connection upgrade');
        }

        if (!this.canProcess()) {
            return new resError.ServiceUnavailableError('Service unavailable');
        }

        if (!checkRequestParams(req)) {
            return new resError.BadRequestError('Invalid request parameters');
        }

        res.send({
            status: 'success',
            data: await CtnOCSvr.ipfsRepo.listRetrievedOffChainMsgData(req.params.retrievedAfter, req.params.limit, req.params.skip)
        });
    })()
    .then(result => {
        next(result);
    }, err => {
        CtnOCSvr.logger.ERROR('Error processing GET \'/msg-data\' API request.', err);
        next(new resError.InternalServerError('Internal server error'));
    });
}

function checkRequestParams(req) {
    let valid = true;

    if (req.params.retrievedAfter) {
        const mtDate = moment(req.params.retrievedAfter, moment.ISO_8601, true);

        if (mtDate.isValid()) {
            req.params.retrievedAfter = mtDate.toDate();
        }
        else {
            CtnOCSvr.logger.DEBUG('getOffChainMsgData: invalid `retrievedAfter` query parameter [%s]', req.params.retrievedAfter);
            valid = false;
        }
    }

    if (req.params.limit) {
        const n = strictParseInt(req.params.limit);

        if (!Number.isNaN(n) && n > 0 && n <= cfgSettings.maxItemsCount) {
            req.params.limit = n;
        }
        else {
            CtnOCSvr.logger.DEBUG('getOffChainMsgData: invalid `limit` request parameter [%s]', req.params.limit);
            valid = false;
        }
    }

    if (req.params.skip) {
        const n = strictParseInt(req.params.skip);

        if (!Number.isNaN(n) && n >= 0) {
            req.params.skip = n;
        }
        else {
            CtnOCSvr.logger.DEBUG('getOffChainMsgData: invalid `skip` request parameter [%s]', req.params.skip);
            valid = false;
        }
    }

    return valid;
}
