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

class Headers {

    static stringify(header) {
        return header && JSON.stringify(header);
    }

    static toJson(headerString) {
        try {
            return JSON.parse(headerString);
        } catch (e) {
            console.error('Server returned invalid or empty header:', headerString);
            return null;
        }
    }

}

class AsyncClient {

    #serverConnectionStrategy;
    #activeRequests = new Map();
    #timeout;
    #chunkSize;
    #debug = true;
    #sessionId = null;
    #nextRequestId = 0;
    #taskQueue = new TaskQueue();

    #defaultRpcConfig = {
        Type: 'RPC 1.0',
        Accept: 'application/json',
        serializePayload: this.#defaultSerializePayload,
    };

    #STATUS = {
        ACCEPTED: 'Accepted', // returned when a partial chunked request is received
        PENDING: 'Pending', // returned when a complete request is received and no sync reply is available
        BUSY: 'Busy', // only returned on the initial request if the server is busy
        SUCCESS : 'Success', // returned to indicate a full or chunked reply is collected successfully
        ERROR: 'Error' // returned at any stage to indicate a problem which causes the process to fail
    };

    #log(...args) {
        if (!this.#debug) return;
        console.log(...args);
    }

    constructor(serverConnectionStrategy, config = {}) {
        this.#serverConnectionStrategy = serverConnectionStrategy;
        this.#chunkSize = config.chunkSize || 1000;
        this.#timeout = config.timeout || 5000;
        this.#defaultRpcConfig.serializePayload = config.serializePayload || this.#defaultSerializePayload;
    }

    async rpcCall(methodName, params = '', config = {},  timeout = this.#timeout) {

        const mergedConfig = { ...this.#defaultRpcConfig, 'Method-Name': methodName, ...config };
        const id = this.#createActiveRequestEntry();
        const headerWithId = this.#createHeaderWithRequestId(mergedConfig, id);
        
        const { header: headerWithPayloadInfoAndId, serializedPayload } = mergedConfig.serializePayload(headerWithId, params);
        
        if (!serializedPayload) {
            throw new Error('Serialization failed');
        }
    
        this.#enqueueRequest(id, headerWithPayloadInfoAndId, serializedPayload);
        return this.#createPromiseWithTimeout(id, timeout);
    }

    #createActiveRequestEntry() {
        const id = this.#generateId();
        this.#activeRequests.set(id, { resolve: null, reject: null });
        return id;
    }

    #generateId() {
        return Date.now().toString() + '-' + this.#nextRequestId++;
    }

    #createHeaderWithRequestId(header, id) {
        return { ...header, 'Request-Id': id };
    }

    #defaultSerializePayload(header, payload) {
        if (typeof payload !== 'object' || payload === null || payload instanceof File) {
            return;
        }
    
        const updatedHeader = { ...header, "Content-Type": "application/json" };
        const serializedPayload = JSON.stringify(payload);
    
        return { header: updatedHeader, serializedPayload };
    }

    #createPromiseWithTimeout(id, timeout) {
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(`Call ${id} timed out`));
                this.#deleteActiveRequestEntry(id);
            }, timeout);
        });

        return Promise.race([
            timeoutPromise,
            this.#createPromise(id, timeoutId),
        ]);
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
                rpcCall.resolve = (data) => {
                    clearTimeout(timeoutId);
                    this.#deleteActiveRequestEntry(id);
                    resolve(data);
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

    async #enqueueRequest(id, originalHeader, serializedPayload) {
    
        const chunkedPayload = this.#chunkSerializedPayload(serializedPayload);
        const totalChunks = chunkedPayload.length;
    
        for (let index = 0; index < totalChunks; ) {
            if (this.#idHasExpired(id)) return;
    
            const header = this.#createHeaderForChunk(originalHeader, index, totalChunks);
            try {
                const response = await this.#enqueueAndDispatch(header, chunkedPayload[index]);
                this.#log('Initial Request Response:', response);

                const shouldRetry = await this.#handleResponseBasedOnStatus(response, id, header);
                if (!shouldRetry) {
                    index++;
                }

            } catch (error) {
                this.#handleSpecificErrors(error, id);
            }
        }
    }
 
    #chunkSerializedPayload(serializedPayload) {
        return serializedPayload.length > this.#chunkSize ? serializedPayload.match(new RegExp(`.{1,${this.#chunkSize}}`, 'g')) : [serializedPayload];
    }

    #idHasExpired(id){
        return !this.#activeRequests.has(id)
    }

    #createHeaderForChunk(originalHeader, index, totalChunks) {
        if (totalChunks <= 1) return originalHeader;
        const isLastChunk = index === totalChunks - 1;
        return {
            ...originalHeader,
            'Chunk-Sequence': index,
            'Chunk-Total': totalChunks,
            'Has-More-Chunks': !isLastChunk
        };
    }
       
    #enqueueAndDispatch(header, chunk) {
        return this.#taskQueue.enqueue(() => this.#dispatchRequest(header, chunk));
    }
    
    #handleSpecificErrors(error, id) {
        this.#handleFailure(id, `An error occurred: ${error.message}`);
    } 

    async #handleResponseBasedOnStatus(response, id, header) {
        const status = this.#getResponseStatus(response);
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
                this.#handleFailure(id, response['Message']);
                return false;
        }
    }

    #getResponseStatus(response) {
        return response['Status'];
    }
    
    async #handleServerIsBusy(response) {
        await this.#delayExecutionByRetryDelay(response);
    }

    async #delayExecutionByRetryDelay(response) {
        const delay = this.#getRetryDelay(response);
        return new Promise((resolve) => {
            if (typeof delay === 'number') {
                this.#log(`Delaying for ${delay}ms based on server response`);
                setTimeout(() => {
                    resolve();
                }, delay);
            } else {
                resolve();
            }
        });
    }

    #getRetryDelay(response) {
        return response['Retry-Delay'];
    }
    
    async #handleSuccessfulRequest(id, header, response) {
        const request = this.#activeRequests.get(id);
        if (!request) {
            return;
        }

        this.#updateRequestData(request, response);
        
        if (this.#hasMoreChunks(response)) {
            await this.#prepareAndEnqueueFollowup(id, header, response);
        } else {
            this.#parseJsonIfRequired(request, response);
            request.resolve(request.data);
        }
    }

    #updateRequestData(request, response) {
        const receivedData = this.#getResponseData(response);
        request.data = request.data ?? '';
        request.data += receivedData;
    }

    #getResponseData(response) {
        return response['Data'];
    }

    #parseJsonIfRequired(request, response) {
        if (response['Accept'] === 'application/json') {
            request.data = JSON.parse(request.data);
        }
    }

    #hasMoreChunks(response) {
        return response['Has-More-Chunks'];
    }

    async #handlePendingResponse(id, header, response) {
        await this.#prepareAndEnqueueFollowup(id, header, response);
    }

    async #prepareAndEnqueueFollowup(id, header, response) {
        if (!response || !this.#hasValidResponseId(response)) {
            this.#handleFailure(id, `No Response-Id returned from server for request ${id}. All follow-ups must have a Response-Id.`);
            return;
        }

        const newHeader = this.#addResponseIdToHeader(response['Response-Id'], header);
        await this.#delayExecutionByRetryDelay(response);
        this.#enqueueFollowup(id, newHeader);
    }

    #hasValidResponseId(response) {
        return response && Boolean(response['Response-Id']);
    }
    
    #addResponseIdToHeader(responseId, header) {
        if (responseId !== undefined) {
            return { ...header, 'Response-Id': responseId };
        }
        return header;
    }
    
    async #enqueueFollowup(id, header) {
        let shouldRetry = false;
        do {
            try {
                if (this.#idHasExpired(id)) return;

                const response = await this.#taskQueue.enqueue(() => this.#dispatchRequest(header));
                this.#log(`Follow-up Pending Response for id ${id}:`, response);
        
                shouldRetry = await this.#handleResponseBasedOnStatus(response, id, header);
                
            } catch (error) {
                this.#handleFailure(id, `An error occurred: ${error.message}`);
            }
        } while (shouldRetry);
    }

    async #dispatchRequest(header, serializedPayload = '') {
        const headerWithSessionId = this.#createHeaderWithSessionId(header);
        this.#log('Dispatching Request :', {header : headerWithSessionId, serializedPayload});
        const response = await this.#serverConnectionStrategy.request(headerWithSessionId, serializedPayload);
        this.#updateSessionIdFromServerResponse(response);
        return response;
    }

    #createHeaderWithSessionId(header) {
        return this.#sessionId 
        ? { ...header, 'Session-Id': this.#sessionId }
        : { ...header };
    }

    #updateSessionIdFromServerResponse(response) {
        if (response['Session-Id']) {
            this.#sessionId = response['Session-Id'];
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

class TcHmiAsyncClient extends AsyncClient {

    constructor(symbolName, config = {}) {
        const defaultSymbol = symbolName || "%s%PLC1.MAIN.api.HandleRequest%/s%";
        const serverConnectionStrategy = new TcHmiSymbolRequestStrategy(defaultSymbol);
        super(serverConnectionStrategy, config);
    }
    
}

class ServerConnectionStrategy {
    async request(header, serializedPayload) {
        throw new Error("Not implemented");
    }
}

class TcHmiSymbolRequestStrategy extends ServerConnectionStrategy {

    #apiHandleClientRequestSymbol;

    constructor(handleClientRequestSymbolName) {
        super();
        this.#apiHandleClientRequestSymbol = new TcHmi.Symbol(handleClientRequestSymbolName);
    }

    async request(header, serializedPayload) {
        const requestPayload = this.#prepareRequestParams(header, serializedPayload);
        const serverResponse = await this.#sendRequest(requestPayload);
        return this.#processServerResponse(serverResponse);
    }

    #prepareRequestParams(header, serializedPayload) {
        return {
            SerializedHeader: Headers.stringify(header),
            SerializedPayload: serializedPayload
        };
    }

    async #sendRequest(requestPayload) {
        try {
            return await this.#writeToSymbol(this.#apiHandleClientRequestSymbol, requestPayload);
        } catch (error) {
            throw new Error(`Error in sending request: ${error.message}`);
        }
    }

    #processServerResponse(serverResponse) {
        const response = serverResponse.Header ? Headers.toJson(serverResponse.Header) : {};

        if (serverResponse.Payload != null && serverResponse.Payload !== '') {
            response.Data = serverResponse.Payload;
        }
        
        return response;
    }

    async #writeToSymbol(symbol, args) {
        return new Promise((resolve, reject) => {
            console.log(symbol, args);
            symbol.write(args, (data) => {
                try {
                    this.#validateData(data, reject);
                    const readValue = this.#getReadValueFromCommand(data.response.commands);
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
            return reject(new Error(response ? response.error.message : 'Response is undefined'));
        }
        if (!response.commands || !response.commands.length) {
            return reject(new Error(response.commands ? 'Command is undefined' : 'Commands are undefined'));
        }
    }

    #getReadValueFromCommand(commands) {
        const [command] = commands;
        if (command.error !== undefined) {
            throw new Error(command.error.message);
        }
        if (!command.readValue) {
            throw new Error('Failed to read command value');
        }
        return command.readValue;
    }

}