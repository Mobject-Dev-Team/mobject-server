# Changelog

## v0.16.0-alpha

- Updated to support mobject-core v0.6.0

## v0.15.0-alpha

- Updated to support mobject-core v0.5.0

## v0.14.0-alpha

- Updated to support mobject-core v0.4.0

## v0.12.0-alpha

- Removed ability for client to re-trigger chunked request with malformed header

## v0.11.0-alpha

- Bugfix, async reject with message was not correctly called and resulted in client timeout.

## v0.10.0-alpha

- Updated to support mobject-core v0.3.0
- Refactored I_RpcApi and RpcServer to better support registration and use of APIs

## v0.9.0-alpha

- Updated to support mobject-core v0.2.0
- Swapped GVL to Parameters

## v0.8.0-alpha

- Updated to support mobject-core v0.1.0, removed all previous mobject libs

## v0.7.0-alpha

- Added Sync and Async rpc. Sync RPC can still be converted to Async, but all explicitly Async RPC handlers will be handled inside of the PLC cycle. SynchronousRpcHandlers should be used with caution, as any long running calls will cause PLC, NC and AUX task timing issues which are not possible to trace. If in doubt, only use AsyncRpc!

!> This update contains the following breaking changes.

- RpcServer.RegisterRpcHandler has been renamed RegisterAsyncRpcHandler
- I_RpcHandler is now I_AsynchronousRpcHandler
- I_SynchronousRpcHandler is now added

## v0.6.0-alpha

- Updated to support mobject-collections v1.3.0
- Updated to support mobject-deserialization v0.3.0
- Updated to support mobject-disposable v1.1.1
- Updated to support mobject-enumerable v1.2.0
- Updated to support mobject-json v1.6.0
- Updated to support mobject-serialization v0.5.0

## v0.5.0-alpha

- Updated to support mobject-json v1.5.0
- Updated to support mobject-collections v1.2.0
- Updated to support mobject-deserialization v0.2.0

## v0.4.0-alpha

- Fixed incorrect clearing of response data.

## v0.3.0-alpha

- Updated to support mobject-json v1.4.0

## v0.2.0-alpha

- Updated to support mobject-json v1.3.0
- Updated to support mobject-serialization v0.4.0
- Updated to support mobject-deserialization v0.1.0
- Updated to support mobject-enumerable v1.1.0
- Updated to support mobject-collections v1.1.0
- Added I_RpcServer interface
- Rpc Handler now takes a deserializer as parameters to simplify parameter extraction.

## v0.1.0-alpha

- Initial
