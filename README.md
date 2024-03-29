# Catenis Off-Chain Server

REST API service for sending and receiving Catenis off-chain messages.

## Deploying the application

To deploy the application, issue the command:

```shell
npm run predeploy
```

A tarball named `catenis-off-chain-server-<version>.tgz` is written to the `dist` subdirectory.

> **Note**: if deploying the application for a non-production environment (i.e., *sandbox* or *development*), use the
 appropriate alternative npm script (i.e., `predeploy-sandbox` or `predeploy-dev`). In that case, the tarball is written
 to a corresponding subdirectory (i.e., `dist/sandbox` or `dist/dev`).

Copy the tarball to the target host and extract its contents, renaming the top-level directory of the extracted contents
 from `package` to `CtnOCSvr`.

```shell
tar -xzf catenis-off-chain-server-<version>.tgz && mv package CtnOCSvr
```

Then change to the top-level directory of the extracted contents (i.e., `cd CtnOCSvr`), and issue the following commands:

```shell
nvm use
npm i
```

> **Note**: optionally append `-g` to the npm install command (i.e., `npm i -g`) to install the application as a global
 Node.js package. In that case, to execute the application, just issue the command `ctnocsvr`.

## Starting the application

To start the application, issue the following command from the application's top-level directory (`CtnOCSvr`):

```shell
nvm use && env NODE_CONFIG_ENV='<environment>' MONGO_URL='mongodb://<host>[:<port>]/<db_name>' node .
```

> **Note 1**: the term `<environment>` should be replaced with the appropriate deployment environment; either
 'development' (the default, if not set), 'sandbox' or 'production'.

> **Note 2**: the MONGO_URL environment variable should be set to a URI connection string specifying the MongoDB
 database instance that shall be used by the application. The term `<port>` is optional and, if omitted, MongoDB's
 default port (27017) is used. If this environment variable is not set, the settings found in the configuration files
 are used, where the default is: `mongodb://localhost/CtnOCSvr`.

> **Note 3**: if the application is installed as a global Node.js package, replace `node .` with `ctnocsvr`.

## How it works

Each instance of the application is configured to accept connections from a single Catenis node.

Catenis off-chain message data structures— either envelopes or receipts— when received are stored onto IPFS using
 IPFS’ Mutable File System—MFS. The updated IPFS repository root (\root) CID is then saved to Catenis Name Service—CNS.

The application continuously monitors CNS to identify the IPFS repositories— of the different Catenis nodes— the root
 CID of which has been updated, and then retrieves the newly added Catenis off-chain message data structures storing them
 to its local database.

## REST API

### Authentication

The requests to the Catenis Off-Chain Server REST API should be authenticated using the [HTTP Signature](https://github.com/joyent/node-http-signature)
 scheme.

Each Catenis node is assigned an SSH RSA key pair for signing the HTTP requests. For more information about assigning
 an SSH RSA key pair to Catenis nodes, please refer to [Catenis Name Server's readme file](https://github.com/blockchainofthings/catenis-name-server/blob/master/README.md).

### Save off-chain message envelope

Request: `POST /msg-data/envelope`

Request body: a JSON object containing the following keys:

- `data`: \[String\] Off-Chain message envelope data as a base64-encoded binary stream.
- `immediateRetrieval`: \[Boolean\] (optional, default: false) Indicates whether saved off-chain message envelope should be immediately retrieved.

Success response body: a JSON containing the following keys:

- `status`: \[String\] The value **'success'**.
- `data.cid`: \[String\] IPFS CID of the saved off-chain message envelope.
- `data.savedDate`: \[String\] ISO-8601 formatted date and time when off-chain message envelope has been saved.

### Save off-chain message receipt

Request: `POST /msg-data/receipt`

Request body: a JSON object containing the following keys:

- `data`: \[String\] Off-Chain message receipt data as a base64-encoded binary stream.
- `immediateRetrieval`: \[Boolean\] (optional, default: false) Indicates whether saved off-chain message receipt should be immediately retrieved.

Success response body: a JSON containing the following keys:

- `status`: \[String\] The value **'success'**.
- `data.cid`: \[String\] IPFS CID of the saved off-chain message receipt.
- `data.savedDate`: \[String\] ISO-8601 formatted date and time when off-chain message receipt has been saved.

### Get off-chain message data

Request: `GET /msg-data`

Query string (optional) parameters:

- `retrievedAfter`: \[String\] ISO-8601 formatted date and time used to filter off-chain message data items that should
 be returned. Only off-chain message data items that have been retrieved after this date should be returned.
- `limit`: \[Number\] (default: 500) Maximum number of data items that should be returned.
- `skip`: \[Number\] (default: 0) Number of data items that should be skipped (from beginning of list of matching data items) and not returned.

> **Note**: the default value for the `limit` query string parameter can be changed via the `maxItemsCount` setting
 of the configuration files.

Success response body: a JSON containing the following keys:

- `status`: \[String\] The value **'success'**.
- `data.dataItems`: \[Array\] List of Catenis off-chain data info objects.
- `data.dataItems[n].cid`: \[String\] IPFS CID of the off-chain message data.
- `data.dataItems[n].data`: \[String\] Off-Chain message data as a base64-encoded binary stream.
- `data.dataItems[n].dataType`: \[String\] Type of off-chain message data; either 'msg-envelope' or 'msg-receipt'.
- `data.dataItems[n].savedDate`: \[String\] ISO-8601 formatted date and time when off-chain message data has originally been saved.
- `data.dataItems[n].retrievedDate`: \[String\] ISO-8601 formatted date and time when off-chain message data has been retrieved.
- `data.hasMore`: \[Boolean\] Indicates whether there are more data items that satisfy the search criteria yet to be returned.

### Get single off-chain message data

Request: `GET /msg-data/:cid`

Query string (optional) parameters:

- `includeSavedOnly`: \[Boolean\] (default: false) Indicates whether it should also look for off-chain message data that have been saved (by this Catenis node) but not yet retrieved.

URL parameters:

- `cid`: \[String\] IPFS CID of the off-chain message data being requested.

Success response body: a JSON containing the following keys:

- `status`: \[String\] The value **'success'**.
- `data.cid`: \[String\] IPFS CID of the off-chain message data.
- `data.data`: \[String\] Off-Chain message data as a base64-encoded binary stream.
- `data.dataType`: \[String\] Type of off-chain message data; either 'msg-envelope' or 'msg-receipt'.
- `data.savedDate`: \[String\] ISO-8601 formatted date and time when off-chain message data has originally been saved.
- `data.retrievedDate`: \[String\] (optional) ISO-8601 formatted date and time when off-chain message data has been retrieved.
 This field will not be returned if `includeSavedOnly` query string parameter is true and off-chain message data is not yet retrieved.

## Client notification

WebSocket connection endpoint: `/notify`

> **Note**: the same authentication scheme used for the REST API should be used when establishing the WebSocket
 connection. 

### New off-chain message data

Outgoing message: NEW_OFF_CHAIN_MSG_DATA

## License

This software is released under the [MIT License](LICENSE). Feel free to fork, and modify!

Copyright © 2020-2023, Blockchain of Things Inc.