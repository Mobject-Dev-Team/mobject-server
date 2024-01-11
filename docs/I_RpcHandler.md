# I_RpcHandler Interface

## Definition

|             |                            |
| ----------- | -------------------------- |
| Namespace   | mobject-server             |
| Library     | mobject-server             |
| Inheritance | \_\_System.IQueryInterface |
| Implements  |                            |

## Remarks

The I_RpcHandler interface should be implemented by any class which is to be used with Rpc Servers. Handlers will be called when their registered method name is invoked.

## Example

```declaration
FUNCTION_BLOCK ConcatStringRpcHandler IMPLEMENTS I_RpcHandler
VAR
END_VAR
```

```body
//... no code should go here.
```

```declaration
METHOD Handle
VAR_INPUT
	Parameters : I_RpcParameters;
	Response : I_SynchronousRpcResponse;
END_VAR
VAR
	str1 : T_MAXSTRING;
	str2 : T_MAXSTRING;
	result : T_MAXSTRING;
END_VAR
```

```body
IF NOT Parameters.TryGetParameter('STR1',str1) THEN
	Response.RejectWithMessage('Missing STR1 parameter');
	RETURN;
END_IF

IF NOT Parameters.TryGetParameter('STR2',str2) THEN
	Response.RejectWithMessage('Missing STR2 parameter');
	RETURN;
END_IF

result := CONCAT(str1, str2);
Response.CompleteWithString(result);
```

## Methods

### Handle(Parameters, Response)

Used to trigger the object for deletion.

#### Parameters

| Parameters | Datatype                 | Description                                                                      |
| ---------- | ------------------------ | -------------------------------------------------------------------------------- |
| Parameters | I_RpcParameters          | Supplied object used for retrieving parameters supplied with the call.           |
| Response   | I_SynchronousRpcResponse | Supplied object used for completing or rejecting the call with or without value. |

#### Return

N/A

#### Usage

The method is automatically invoked by the server. There is no requirement to call this method manually.
