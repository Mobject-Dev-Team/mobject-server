# RpcServer Class

## Definition

|             |                |
| ----------- | -------------- |
| Namespace   | mobject-server |
| Library     | mobject-server |
| Inheritance |                |
| Implements  |                |

## Remarks

The RpcServer class allows you to support rpc calls to the PLC via ADS. Rpc handlers are registered with the RpcServer to action the call.

## Example

```declaration
PROGRAM Main
VAR
   initialized : BOOL;
   server : RpcServer;
   concatStringRpcHandler : ConcatStringRpcHandler;
END_VAR
```

```body
IF NOT initialized THEN
	server.RegisterRpcHandler('concat',concatStringRpcHandler);
   initialized := TRUE;
END_IF

server.CyclicCall();

/*
external mobject-clients may now call upon server.HandleRequest(header, payload) to trigger the RPC handler.  mobject-clients handle the creation of the header and payload, but as an example, the following is sent and received.

header '{"Type":"RPC 1.0","Method-Name":"concat","Content-Type":"application/json"}'
payload '{"STR1":"hello", "STR2":"world"}'

response.payload '"helloworld"'
*/

```

## Methods

### CyclicCall()

The server requires cyclic calling to manage internal timers for sessions. CyclicCall must be called once per PLC cycle

#### Parameters

N/A

#### Return

N/A

#### Usage

```example
server.CyclicCall();
```

### HandleRequest(SerializedHeader, SerializedPayload) : ResponseData

Documentation coming soon...

### RegisterRpcHandler(MethodName, Handler)

Documentation coming soon...

### Use(Middleware)

Documentation coming soon...

## Properties

### SessionCount

Documentation coming soon...
