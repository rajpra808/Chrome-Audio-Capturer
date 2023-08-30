importScripts("/../encoders/WavEncoder.min.js");
let webSocket = null;
let messageQueue = [];
let sampleRate = 44100,
    numChannels = 2,
    options = undefined,
    maxBuffers = undefined,
    encoder = undefined,
    recBuffers = undefined,
    bufferCount = 0;

function error(message) {
  self.postMessage({ command: "error", message: "wav: " + message });
}

function keepAlive() {
  const keepAliveIntervalId = setInterval(
    () => {
      if (webSocket) {
        webSocket.send('keepalive');
      } else {
        clearInterval(keepAliveIntervalId);
      }
    },
    // Set the interval to 20 seconds to prevent the service worker from becoming inactive.
    20 * 1000 
  );
}

function connect() {
  webSocket = new WebSocket('ws://localhost:3000');

  webSocket.onopen = (event) => {
    console.log('websocket open');
    keepAlive();

    // Send any buffered messages
    while (messageQueue.length > 0 && webSocket.readyState === WebSocket.OPEN) {
      const bufferedMessage = messageQueue.shift();
      webSocket.send(bufferedMessage);
      // Handle encoding or other logic here
    }
  };

  webSocket.onmessage = (event) => {
    console.log(`websocket received message: ${event.data}`);
  };

  webSocket.onclose = (event) => {
    console.log('websocket connection closed');
    webSocket = null;
  };
}

function disconnect() {
  if (webSocket == null) {
    return;
  }
  webSocket.close();
}


function init(data) {
  sampleRate = data.config.sampleRate;
  numChannels = data.config.numChannels;
  options = data.options;
};

function setOptions(opt) {
  if (encoder || recBuffers)
    error("cannot set options during recording");
  else
    options = opt;
}

function start(bufferSize) {
  maxBuffers = Math.ceil(options.timeLimit * sampleRate / bufferSize);
  if (options.encodeAfterRecord)
    recBuffers = [];
  else
    encoder = new WavAudioEncoder(sampleRate, numChannels);
}

function record(buffer) {
  if (webSocket.readyState === WebSocket.OPEN) {
    webSocket.send(buffer[0]); // sending only one channel 
  } else {
    console.log("WebSocket is still connecting or closed. Buffer added to queue.");
    messageQueue.push(buffer[0]);
  }

  if (bufferCount++ < maxBuffers)
    if (encoder)
      encoder.encode(buffer);
    else if(recBuffers)
      recBuffers.push(buffer);
  else
    self.postMessage({ command: "timeout" });
};

function postProgress(progress) {
  self.postMessage({ command: "progress", progress: progress });
};

function finish() {
  if (recBuffers) {
    postProgress(0);
    encoder = new WavAudioEncoder(sampleRate, numChannels);
    var timeout = Date.now() + options.progressInterval;
    while (recBuffers.length > 0) {
      encoder.encode(recBuffers.shift());
      var now = Date.now();
      if (now > timeout) {
        postProgress((bufferCount - recBuffers.length) / bufferCount);
        timeout = now + options.progressInterval;
      }
    }
    postProgress(1);
  }
  self.postMessage({
    command: "complete",
    blob: encoder.finish(options.wav.mimeType)
  });
  cleanup();
};

function cleanup() {
  encoder = recBuffers = undefined;
  bufferCount = 0;
}

self.onmessage = function(event) {
  var data = event.data;
  switch (data.command) {
    case "init":                
        console.log("Initiating worker!")
        connect();
        init(data);                 
        break;
    case "options": setOptions(data.options);   break;
    case "start":   start(data.bufferSize);     break;
    case "record":  record(data.buffer);        break;
    case "finish":  disconnect(); finish();                   break;
    case "cancel":  disconnect(); cleanup();
  }
};

self.postMessage({ command: "loaded" });
