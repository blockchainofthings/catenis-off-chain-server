# Changelog

## [1.1.4] - 2023-02-09

### Changes
- No source code changes; update package.json so dependency modules not published on NPM can be freely downloaded.

## [1.1.3] - 2023-01-26

### Changes
- Update license, copyright and source code repository information.

### Fixes
- Fix issue creating a new repository root directory.

## [1.1.2] - 2021-05-26

### Changes
- Refactoring to stop using the dependency module 'fibers'.
- Refactoring to stop using the dependency module Babel.
- Update dependency module 'ipfs-http-client' to its latest compatible version.
- Properly handle error updating a pin when previous CID is not part of the pin set.
- Update dependency module 'catenis-off-chain-lib' to its latest version, which supports the latest version of IPFS
 components.

### Fixes
- Update write concern parameter used for creating MongoDB database collection indexes to avoid deprecation warning.
- Fix function used to finalize shutdown.

## [1.1.1] - 2020-08-01

### Fixes
- Upgrade dependency modules to mitigate security vulnerabilities.

### Changes
- Preparations for using application in production environment.

## [1.1.0] - 2020-05-11

### Changes
- Updated dependency module `ipfs-http-client` to its latest version (44.0.3) to target IPFS version 0.5.0.

## [1.0.0] - 2020-01-21

### New features
- Initial version.