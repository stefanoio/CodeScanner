class CodeScanner {
	_polyfillScrs = [
		"https://cdn.jsdelivr.net/npm/@undecaf/zbar-wasm@0.10.1/dist/index.js",
		"https://cdn.jsdelivr.net/npm/@undecaf/barcode-detector-polyfill@0.9.20/dist/index.js"
	];
	_ready = false;
	_running = false;
	_error = false;
	_readyCallbacks = [];
	_errorCallbacks = [];

	constructor(videoElement, requestedFormats = false, frameRate = 10) {
		if(!(videoElement instanceof HTMLVideoElement)) {
			this._setIsError();
			throw new Error("The first argument must be a video element");
		}
		if(requestedFormats !== false && !Array.isArray(requestedFormats)) {
			this._setIsError();
			throw new Error("The second argument must be an array of formats or false");
		}
		if(typeof frameRate !== "number" || frameRate <= 0) {
			this._setIsError();
			throw new Error("The third argument must be a positive number");
		}

		this._initBarcodeDetector()
			.then(({ barcodeDetector, supportedFormats }) => {
				this._videoElement = videoElement;
				this._formats = requestedFormats;
				this._frameRate = frameRate;
				this._barcodeDetector = new barcodeDetector;
				this._supportedFormats = supportedFormats;
				if(requestedFormats === false) {
					this._formats = this._supportedFormats;
				} else {
					requestedFormats.forEach(format => {
						if(!this._supportedFormats.includes(format)) {
							this._setIsError();
							throw new Error(`Format ${format} is not supported. Supported formats are: ${this._supportedFormats.join(", ")}`);
						}
					});
					this._formats = requestedFormats;
				}
				this._setIsReady();
			})
			.catch(() => this._setIsError());
	}

	_setIsReady() {
		this._ready = true;
		this._error = false;
		this._readyCallbacks.forEach(callback => callback());
		this._readyCallbacks = [];
		this._errorCallbacks = [];
	}

	_setIsError() {
		this._error = true;
		this._ready = false;
		this._errorCallbacks.forEach(callback => callback());
		this._readyCallbacks = [];
		this._errorCallbacks = [];
	}

	async _initBarcodeDetector() {
		const returnFormat = async barcodeDetector => ({
			barcodeDetector: barcodeDetector,
			supportedFormats: await barcodeDetector.getSupportedFormats()
		});
		try {
			return await returnFormat(window.BarcodeDetector);
		} catch { }
		try {
			return await returnFormat(barcodeDetectorPolyfill.BarcodeDetectorPolyfill);
		} catch { }
		try {
			for(const src of this._polyfillScrs) {
				// Concurrent loading seems to cause dependency issues
				await new Promise((resolve, reject) => {
					const script = document.createElement("script");
					script.src = src;
					script.addEventListener("load", () => resolve());
					script.addEventListener("error", () => reject());
					document.head.appendChild(script);
				});
			};
			return await returnFormat(barcodeDetectorPolyfill.BarcodeDetectorPolyfill);
		} catch {
			throw new Error("Could not load the barcode detector polyfill");
		}
	}

	async _isReady() {
		await new Promise((resolve, reject) => {
			if(this._error) {
				reject();
			}
			if(this._ready) {
				resolve();
			} else {
				this._readyCallbacks.push(resolve);
				this._errorCallbacks.push(reject);
			}
		});
	}

	async getSupportedFormats() {
		await this._isReady();
		return this._supportedFormats;
	}

	async start() {
		await this._isReady();
		if(this._running) {
			throw new Error("The scanner is already running");
		}
		this._running = true;
		try {
			this._videoElement.srcObject = await navigator.mediaDevices.getUserMedia({
				video: {
					facingMode: {
						ideal: "environment"
					}
				},
				audio: false
			});
			await this._videoElement.play();
		} catch {
			this._running = false;
			throw new Error("Could not start the camera");
		}
		this._readingInterval = window.setInterval(async () => {
			const barcodes = await this._barcodeDetector.detect(this._videoElement);
			if(barcodes.length) {
				this._videoElement.dispatchEvent(new CustomEvent("codeDetected", {
					detail: barcodes
				}));
			}
		}, 1000 / this._frameRate);
	}

	async stop() {
		await this._isReady();
		if(!this._running) {
			throw new Error("The scanner is not running");
		}
		if(this._readingInterval) {
			window.clearInterval(this._readingInterval);
		}
		this._videoElement.srcObject.getTracks().forEach(track => track.stop());
		this._running = false;
	}
}
