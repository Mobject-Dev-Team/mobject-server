// Keep these lines for a best effort IntelliSense of Visual Studio 2017 and higher.
// <reference path='./../Packages/Beckhoff.TwinCAT.HMI.Framework.12.760.44/runtimes/native1.12-tchmi/TcHmi.d.ts' />
class TaskQueue {
  #taskQueue = [];
  #isProcessing = false;

  enqueue(task) {
    return new Promise((resolve, reject) => {
      const wrappedTask = async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };

      this.#taskQueue.push(wrappedTask);
      this.#processTasks();
    });
  }

  async #processTasks() {
    if (this.#isProcessing) return;

    this.#isProcessing = true;
    try {
      while (this.#taskQueue.length > 0) {
        const queuedTask = this.#taskQueue.shift();
        await queuedTask();
      }
    } finally {
      this.#isProcessing = false;
    }
  }
}

class Header {
  #header = {};

  constructor(initial = "") {
    try {
      this.#header = JSON.parse(initial);
    } catch (e) {
      this.#header = {};
    }
  }

  GetField(key) {
    return this.#header[key];
  }

  WriteField(key, value) {
    this.#header[key] = value;
  }

  toString() {
    return JSON.stringify(this.#header);
  }

  toJSON() {
    return JSON.stringify(this.#header);
  }
}

class HeaderAccessor {
  static contentType_Json = "application/json";
  static headerKey_Accept = "Accept";
  static headerKey_ChunkSequence = "Chunk-Sequence";
  static headerKey_ChunkTotal = "Chunk-Total";
  static headerKey_ContentType = "Content-Type";
  static headerKey_HasMoreChunks = "Has-More-Chunks";
  static headerKey_Message = "Message";
  static headerKey_MethodName = "Method-Name";
  static headerKey_RequestId = "Request-Id";
  static headerKey_ResponseId = "Response-Id";
  static headerKey_RetryDelay = "Retry-Delay";
  static headerKey_SessionId = "Session-Id";
  static headerKey_Status = "Status";
  static headerKey_Type = "Type";

  static acceptTypeIsJson(header) {
    if (
      header.GetField(HeaderAccessor.headerKey_Accept) ==
      HeaderAccessor.contentType_Json
    ) {
      return true;
    }
  }

  static readAcceptType(header) {
    return header.GetField(HeaderAccessor.headerKey_Accept);
  }

  static readHasMoreChunks(header) {
    return header.GetField(HeaderAccessor.headerKey_HasMoreChunks);
  }

  static readMessage(header) {
    return header.GetField(HeaderAccessor.headerKey_Message);
  }

  static readResponseId(header) {
    return header.GetField(HeaderAccessor.headerKey_ResponseId);
  }

  static readRetryDelay(header) {
    return header.GetField(HeaderAccessor.headerKey_RetryDelay);
  }

  static readSessionId(header) {
    return header.GetField(HeaderAccessor.headerKey_SessionId);
  }

  static readStatus(header) {
    return header.GetField(HeaderAccessor.headerKey_Status);
  }

  static updateAcceptedFormat(header, format) {
    header.WriteField(HeaderAccessor.headerKey_Accept, format);
  }

  static updateAcceptedFormatToJson(header) {
    header.WriteField(
      HeaderAccessor.headerKey_Accept,
      HeaderAccessor.contentType_Json
    );
  }

  static updateChunkInformation(header, currentChunkIndex, totalChunks) {
    if (totalChunks <= 1) {
      return;
    }

    const isLastChunk = currentChunkIndex === totalChunks - 1;
    header.WriteField(
      HeaderAccessor.headerKey_ChunkSequence,
      currentChunkIndex + 1
    );
    header.WriteField(HeaderAccessor.headerKey_ChunkTotal, totalChunks);
    header.WriteField(HeaderAccessor.headerKey_HasMoreChunks, !isLastChunk);
  }

  static updateContentType(header, type) {
    header.WriteField(HeaderAccessor.headerKey_ContentType, type);
  }

  static updateContentTypeToJson(header) {
    header.WriteField(
      HeaderAccessor.headerKey_ContentType,
      HeaderAccessor.contentType_Json
    );
  }

  static updateMethodName(header, methodName) {
    header.WriteField(HeaderAccessor.headerKey_MethodName, methodName);
  }

  static updateRequestId(header, requestId) {
    header.WriteField(HeaderAccessor.headerKey_RequestId, requestId);
  }

  static updateResponseId(header, responseId) {
    header.WriteField(HeaderAccessor.headerKey_ResponseId, responseId);
  }

  static updateSessionId(header, sessionId) {
    header.WriteField(HeaderAccessor.headerKey_SessionId, sessionId);
  }

  static updateType(header, type) {
    header.WriteField(HeaderAccessor.headerKey_Type, type);
  }
}

class JsonPayloadMarshaller {
  marshall(header, payload) {
    if (
      typeof payload !== "object" ||
      payload === null ||
      payload instanceof File
    ) {
      return;
    }

    HeaderAccessor.updateContentTypeToJson(header);
    return JSON.stringify(payload);
  }

  unmarshall(seralizedPayload) {
    return JSON.parse(seralizedPayload);
  }
}

class SequentialRequestIdGenerator {
  #current = 0;

  constructor(seed = 0) {
    this.#current = seed;
  }

  generate() {
    this.#current++;
    return this.#current.toString();
  }
}

class RpcClient {
  #client = null;

  constructor(serverConnectionStrategy, config = {}) {
    this.#client = new AsyncClient(serverConnectionStrategy, config);
  }

  async rpcCall(methodName, params = "", timeout) {
    const header = new Header();
    const payload = params;
    const marshaller = new JsonPayloadMarshaller();

    HeaderAccessor.updateType(header, "RPC 1.0");
    HeaderAccessor.updateMethodName(header, methodName);

    return this.#client.request(header, payload, marshaller, timeout);
  }
}

class AsyncClient {
  #serverConnectionStrategy;
  #activeRequests = new Map();
  #timeout;
  #stackSize;
  #chunkSize;
  #debug = true;
  #sessionId = null;
  #idGenerator = new SequentialRequestIdGenerator();
  #taskQueue = new TaskQueue();

  #STATUS = {
    ACCEPTED: "Accepted", // returned when a partial chunked request is received
    PENDING: "Pending", // returned when a complete request is received and no sync reply is available
    BUSY: "Busy", // only returned on the initial request if the server is busy
    SUCCESS: "Success", // returned to indicate a full or chunked reply is collected successfully
    ERROR: "Error", // returned at any stage to indicate a problem which causes the process to fail
  };

  #log(...args) {
    if (!this.#debug) return;
    console.log(...args);
  }

  constructor(serverConnectionStrategy, config = {}) {
    this.#serverConnectionStrategy = serverConnectionStrategy;

    this.#stackSize = config.stackSize || 64000;
    this.#chunkSize = config.chunkSize || this.#stackSize / 8;
    this.#timeout = config.timeout || 5000;
  }

  async request(
    header = new Header(),
    payload,
    marshaller,
    timeout = this.#timeout
  ) {
    const serializedPayload = marshaller.marshall(header, payload);

    const requestId = this.#createActiveRequestEntry();
    HeaderAccessor.updateRequestId(header, requestId);

    this.#enqueueRequest(requestId, header, serializedPayload);
    const serializedResponse = await this.#createPromiseWithTimeout(
      requestId,
      timeout
    );
    return marshaller.unmarshall(serializedResponse);
  }

  #createActiveRequestEntry() {
    const id = this.#idGenerator.generate();
    this.#activeRequests.set(id, { resolve: null, reject: null });
    return id;
  }

  #createPromiseWithTimeout(id, timeout) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Call ${id} timed out`));
        this.#deleteActiveRequestEntry(id);
      }, timeout);
    });

    return Promise.race([timeoutPromise, this.#createPromise(id, timeoutId)]);
  }

  #createPromise(id, timeoutId) {
    return new Promise((resolve, reject) => {
      const rpcCall = this.#activeRequests.get(id);
      if (rpcCall) {
        rpcCall.reject = (reason) => {
          clearTimeout(timeoutId);
          this.#deleteActiveRequestEntry(id);
          reject(reason);
        };
        rpcCall.resolve = (payload) => {
          clearTimeout(timeoutId);
          this.#deleteActiveRequestEntry(id);
          resolve(payload);
        };
      } else {
        throw new Error(`Call ${id} not found`);
      }
    });
  }

  #deleteActiveRequestEntry(id) {
    if (this.#activeRequests.has(id)) {
      this.#activeRequests.delete(id);
    }
  }

  async #enqueueRequest(id, header, serializedPayload) {
    const chunkedPayload = this.#chunkSerializedPayload(serializedPayload);
    const totalChunks = chunkedPayload.length;

    for (let index = 0; index < totalChunks; ) {
      if (this.#idHasExpired(id)) {
        return;
      }

      HeaderAccessor.updateChunkInformation(header, index, totalChunks);
      try {
        const response = await this.#enqueueAndDispatch(
          header,
          chunkedPayload[index]
        );
        this.#log("Initial Response:", JSON.stringify(response));

        const shouldRetry = await this.#handleResponseBasedOnStatus(
          response,
          id,
          header
        );
        if (!shouldRetry) {
          index++;
        }
      } catch (error) {
        this.#handleSpecificErrors(error, id);
      }
    }
  }

  #chunkSerializedPayload(serializedPayload) {
    return serializedPayload.length > this.#chunkSize
      ? serializedPayload.match(new RegExp(`.{1,${this.#chunkSize}}`, "g"))
      : [serializedPayload];
  }

  #idHasExpired(id) {
    return !this.#activeRequests.has(id);
  }

  #enqueueAndDispatch(header, chunk) {
    return this.#taskQueue.enqueue(() => this.#dispatchRequest(header, chunk));
  }

  #handleSpecificErrors(error, id) {
    this.#handleFailure(id, `An error occurred: ${error.message}`);
  }

  async #handleResponseBasedOnStatus(response, id, header) {
    const status = HeaderAccessor.readStatus(response.header);
    switch (status) {
      case this.#STATUS.ACCEPTED:
        return false;
      case this.#STATUS.PENDING:
        this.#handlePendingResponse(id, header, response);
        return false;
      case this.#STATUS.BUSY:
        await this.#handleServerIsBusy(response);
        return true;
      case this.#STATUS.SUCCESS:
        this.#handleSuccessfulRequest(id, header, response);
        return false;
      case this.#STATUS.ERROR:
      default:
        this.#handleFailure(id, HeaderAccessor.readMessage(response.header));
        return false;
    }
  }

  async #handleServerIsBusy(response) {
    retryDelay = HeaderAccessor.readRetryDelay(response.header);
    await this.#delayExecution(retryDelay);
  }

  async #delayExecution(delayTimeInMs) {
    return new Promise((resolve) => {
      if (typeof delayTimeInMs === "number") {
        this.#log(`Delaying for ${delayTimeInMs}ms based on server response`);
        setTimeout(() => {
          resolve();
        }, delayTimeInMs);
      } else {
        resolve();
      }
    });
  }

  async #handleSuccessfulRequest(id, header, response) {
    const activeRequest = this.#activeRequests.get(id);
    if (!activeRequest) {
      return;
    }

    this.#updateActiveRequestPayload(activeRequest, response);

    if (HeaderAccessor.readHasMoreChunks(response.header)) {
      const responseId = HeaderAccessor.readResponseId(response.header);
      const retryDelay = HeaderAccessor.readRetryDelay(response.header);
      await this.#prepareAndEnqueueFollowup(id, header, responseId, retryDelay);
    } else {
      activeRequest.resolve(activeRequest.payload);
    }
  }

  #updateActiveRequestPayload(activeRequest, response) {
    const receivedPayload = response.payload;
    activeRequest.payload = activeRequest.payload ?? "";
    activeRequest.payload += receivedPayload;
  }

  async #handlePendingResponse(id, header, response) {
    const responseId = HeaderAccessor.readResponseId(response.header);
    const retryDelay = HeaderAccessor.readRetryDelay(response.header);
    await this.#prepareAndEnqueueFollowup(id, header, responseId, retryDelay);
  }

  async #prepareAndEnqueueFollowup(id, header, responseId, retryDelay = 0) {
    if (!responseId) {
      this.#handleFailure(
        id,
        `No Response-Id returned from server for request ${id}. All follow-ups must have a Response-Id.`
      );
      return;
    }

    HeaderAccessor.updateResponseId(header, responseId);
    await this.#delayExecution(retryDelay);
    this.#enqueueFollowup(id, header);
  }

  async #enqueueFollowup(id, header) {
    let shouldRetry = false;
    do {
      try {
        if (this.#idHasExpired(id)) return;

        const response = await this.#taskQueue.enqueue(() =>
          this.#dispatchRequest(header)
        );
        this.#log(
          `Reply from Server from Follow-up for id ${id}:`,
          JSON.stringify(response)
        );

        shouldRetry = await this.#handleResponseBasedOnStatus(
          response,
          id,
          header
        );
      } catch (error) {
        this.#handleFailure(id, `An error occurred: ${error.message}`);
      }
    } while (shouldRetry);
  }

  async #dispatchRequest(header, serializedPayload = "") {
    if (this.#sessionId) {
      HeaderAccessor.updateSessionId(header, this.#sessionId);
    }

    this.#log("Dispatching Request :", {
      header: JSON.stringify(header),
      serializedPayload,
    });

    const rawResponse = await this.#serverConnectionStrategy.request(
      header.toString(),
      serializedPayload
    );

    const response = this.#processServerResponse(rawResponse);
    this.#updateSessionIdFromServerResponse(response);
    return response;
  }

  #processServerResponse(serverResponse) {
    const header = new Header(serverResponse.Header);
    const response = { header };

    if (serverResponse.Payload != null && serverResponse.Payload !== "") {
      response.payload = serverResponse.Payload;
    }

    return response;
  }

  #updateSessionIdFromServerResponse(response) {
    const sessionId = HeaderAccessor.readSessionId(response.header);
    if (sessionId) {
      this.#sessionId = sessionId;
    }
  }

  #handleFailure(id, message) {
    const request = this.#activeRequests.get(id);
    if (request) {
      const modifiedError = new Error(`Call ${id}: ${message}`);
      request.reject(modifiedError);
    }
  }
}

class TcHmiRpcClient extends RpcClient {
  constructor(symbolName, config = {}) {
    const defaultSymbol = symbolName || "%s%PLC1.MAIN.api.HandleRequest%/s%";
    const serverConnectionStrategy = new TcHmiSymbolRequestStrategy(
      defaultSymbol
    );
    super(serverConnectionStrategy, config);
  }
}

class ServerConnectionStrategy {
  async request(SerializedHeader, SerializedPayload) {
    throw new Error("Not implemented");
  }
}

class TcHmiSymbolRequestStrategy extends ServerConnectionStrategy {
  #apiHandleClientRequestSymbol;
  #debug = false;

  constructor(handleClientRequestSymbolName) {
    super();
    this.#apiHandleClientRequestSymbol = new TcHmi.Symbol(
      handleClientRequestSymbolName
    );
  }

  #log(...args) {
    if (!this.#debug) return;
    console.log(...args);
  }

  async request(SerializedHeader, SerializedPayload) {
    const requestPayload = {
      SerializedHeader,
      SerializedPayload,
    };
    const serverResponse = await this.#sendRequest(requestPayload);
    return serverResponse;
  }

  async #sendRequest(requestPayload) {
    try {
      return await this.#writeToSymbol(
        this.#apiHandleClientRequestSymbol,
        requestPayload
      );
    } catch (error) {
      throw new Error(`Error in sending request: ${error.message}`);
    }
  }

  async #writeToSymbol(symbol, args) {
    return new Promise((resolve, reject) => {
      this.#log(symbol, args);
      symbol.write(args, (data) => {
        try {
          this.#validateData(data, reject);
          const readValue = this.#getReadValueFromCommand(
            data.response.commands
          );
          resolve(readValue);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  #validateData(data, reject) {
    const { error, response } = data;
    if (error !== TcHmi.Errors.NONE) {
      return reject(new Error(data.details.errors[0].message));
    }
    if (!response || response.error !== undefined) {
      return reject(
        new Error(response ? response.error.message : "Response is undefined")
      );
    }
    if (!response.commands || !response.commands.length) {
      return reject(
        new Error(
          response.commands ? "Command is undefined" : "Commands are undefined"
        )
      );
    }
  }

  #getReadValueFromCommand(commands) {
    const [command] = commands;
    if (command.error !== undefined) {
      throw new Error(command.error.message);
    }
    if (!command.readValue) {
      throw new Error("Failed to read command value");
    }
    return command.readValue;
  }
}
