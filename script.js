        const dropZone = document.getElementById('dropZone');
        const fileInput = document.getElementById('fileInput');
        const canvasContainer = document.getElementById('canvasContainer');
        const downloadBtn = document.getElementById('downloadBtn');
        const removeBtn = document.getElementById('removeBtn');
        const controlsContainer = document.getElementById('controlsContainer');
        const fileInfo = document.getElementById('fileInfo');
        const fileNameDisplay = document.getElementById('fileName');
        const fileDuration = document.getElementById('fileDuration');
        const loading = document.getElementById('loading');

        let audioContext;
        let audioBuffer;

        // Drag and drop handlers
        dropZone.addEventListener('click', () => fileInput.click());

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('audio/')) {
                handleFile(file);
            }
        });

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                handleFile(file);
            }
        });

        async function handleFile(file) {
            loading.classList.remove('hidden');
            canvasContainer.classList.add('hidden');
            fileInfo.classList.add('hidden');
            controlsContainer.classList.add('hidden');

            try {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const arrayBuffer = await file.arrayBuffer();
                audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

                const channels = audioBuffer.numberOfChannels;
                const channelText = channels === 1 ? 'Mono' : channels === 2 ? 'Stereo' : `${channels} Channels`;

                fileNameDisplay.textContent = file.name;
                fileDuration.textContent = `Duration: ${audioBuffer.duration.toFixed(2)}s | ${channelText} | Sample Rate: ${audioBuffer.sampleRate}Hz`;
                fileInfo.classList.remove('hidden');

                await generateSpectrograms();

                loading.classList.add('hidden');
                canvasContainer.classList.remove('hidden');
                controlsContainer.classList.remove('hidden');
            } catch (error) {
                console.error('Error processing audio:', error);
                alert('Error processing audio file: ' + error.message);
                loading.classList.add('hidden');
                resetUI();
            }
        }

        async function generateSpectrograms() {
            canvasContainer.innerHTML = '';
            const numChannels = Math.min(audioBuffer.numberOfChannels, 2); // Support up to stereo

            const width = Math.min(window.innerWidth - 100, 1800);
            const height = numChannels === 2 ? 350 : 600;

            const currentFileName = fileNameDisplay.textContent;

            for (let channel = 0; channel < numChannels; channel++) {
                const wrapper = document.createElement('div');
                wrapper.className = 'spectrogram-wrapper';

                const label = document.createElement('div');
                label.className = 'channel-label';
                label.textContent = numChannels === 2 ? (channel === 0 ? 'Left Channel' : 'Right Channel') : 'Mono';
                wrapper.appendChild(label);

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                wrapper.appendChild(canvas);

                const timeLabels = document.createElement('div');
                timeLabels.className = 'time-labels';
                wrapper.appendChild(timeLabels);

                canvasContainer.appendChild(wrapper);

                // FIX: Pass isFirstChannel boolean correctly
                await generateSpectrogramForChannel(canvas, timeLabels, channel, channel === 0, currentFileName);
            }
        }

        async function generateSpectrogramForChannel(canvas, timeLabelsDiv, channelIndex, isFirstChannel, fileName) {
            const ctx = canvas.getContext('2d');
            const width = canvas.width;
            const height = canvas.height;

            // Background
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, width, height);

            const channelData = audioBuffer.getChannelData(channelIndex);
            const sampleRate = audioBuffer.sampleRate;

            // FIX: Pass isFirstChannel to the manual generation function
            await generateSpectrogramManual(ctx, channelData, sampleRate, width, height, isFirstChannel, fileName);
            drawTimeLabels(timeLabelsDiv, audioBuffer.duration);
        }

        // Fast Fourier Transform implementation (Radix-2 Cooley-Tukey)
        // Replaces the slow naive DFT to ensure performance
        function calculateFFT(buffer) {
            const n = buffer.length;
            if (n <= 1) return buffer.map(val => ({re: val, im: 0, mag: Math.abs(val)}));

            const real = new Float32Array(buffer);
            const imag = new Float32Array(n);

            // Bit-reversal permutation
            let j = 0;
            for (let i = 0; i < n - 1; i++) {
                if (i < j) {
                    [real[i], real[j]] = [real[j], real[i]];
                    [imag[i], imag[j]] = [imag[j], imag[i]];
                }
                let k = n / 2;
                while (k <= j) {
                    j -= k;
                    k /= 2;
                }
                j += k;
            }

            // Cooley-Tukey FFT
            for (let len = 2; len <= n; len *= 2) {
                const halfLen = len / 2;
                const angle = -2 * Math.PI / len;
                const wStepRe = Math.cos(angle);
                const wStepIm = Math.sin(angle);

                for (let i = 0; i < n; i += len) {
                    let wRe = 1;
                    let wIm = 0;
                    for (let k = 0; k < halfLen; k++) {
                        const uRe = real[i + k];
                        const uIm = imag[i + k];
                        const vRe = real[i + k + halfLen] * wRe - imag[i + k + halfLen] * wIm;
                        const vIm = real[i + k + halfLen] * wIm + imag[i + k + halfLen] * wRe;

                        real[i + k] = uRe + vRe;
                        imag[i + k] = uIm + vIm;
                        real[i + k + halfLen] = uRe - vRe;
                        imag[i + k + halfLen] = uIm - vIm;

                        let wReTemp = wRe * wStepRe - wIm * wStepIm;
                        wIm = wRe * wStepIm + wIm * wStepRe;
                        wRe = wReTemp;
                    }
                }
            }

            // Return magnitudes for the first half (symmetric spectrum)
            const magnitudes = new Float32Array(n / 2);
            for (let i = 0; i < n / 2; i++) {
                magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
            }
            return magnitudes;
        }

        async function generateSpectrogramManual(ctx, channelData, sampleRate, width, height, isFirstChannel, fileName) {
            const fftSize = 2048;
            const hopSize = Math.floor(fftSize / 4);
            const numFrames = Math.floor((channelData.length - fftSize) / hopSize);
            const freqBins = fftSize / 2;

            const spectrogram = [];
            let maxMagnitude = 0;

            // Optimized Window Function (Hamming) + FFT
            for (let i = 0; i < numFrames; i++) {
                const offset = i * hopSize;
                const frame = channelData.slice(offset, offset + fftSize);

                // Apply Hamming window
                const windowed = new Float32Array(fftSize);
                for (let n = 0; n < fftSize; n++) {
                    windowed[n] = frame[n] * (0.54 - 0.46 * Math.cos(2 * Math.PI * n / fftSize));
                }

                // Use FFT instead of Naive DFT
                const magnitudes = calculateFFT(windowed);

                spectrogram.push(magnitudes);

                // Track max magnitude for normalization
                for(let k=0; k<freqBins; k++) {
                    if(magnitudes[k] > maxMagnitude) maxMagnitude = magnitudes[k];
                }

                // Yield to browser every 50 frames to keep UI responsive
                if (i % 50 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            // Draw spectrogram - scale to fill width
            const timeStep = width / numFrames;
            const freqStep = height / freqBins;

            for (let t = 0; t < numFrames; t++) {
                const x = Math.floor(t * timeStep);
                const xWidth = Math.ceil(timeStep) + 1;

                for (let f = 0; f < freqBins; f++) {
                    const magnitude = spectrogram[t][f];
                    // Avoid log(0)
                    const normalized = magnitude / (maxMagnitude || 1);
                    const db = 20 * Math.log10(normalized + 1e-10);
                    const dbNormalized = Math.max(0, (db + 100) / 100); // Adjusted range

                    const color = getSpectrogramColor(dbNormalized);
                    ctx.fillStyle = color;
                    ctx.fillRect(
                        x,
                        height - Math.floor((f + 1) * freqStep),
                        xWidth,
                        Math.ceil(freqStep) + 1
                    );
                }
            }

            // Draw frequency axis
            drawFrequencyAxis(ctx, width, height, sampleRate);

            // FIX: Use isFirstChannel to decide whether to draw filename
            if (isFirstChannel) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText(fileName || 'Audio File', 10, 20);
            }
        }

        function getSpectrogramColor(intensity) {
            // Color scheme: black -> purple -> red -> orange -> yellow
            if (intensity < 0.25) {
                const t = intensity * 4;
                const r = Math.floor(160 * t);
                const g = Math.floor(32 * t);
                const b = Math.floor(240 * t);
                return `rgb(${r},${g},${b})`;
            } else if (intensity < 0.5) {
                const t = (intensity - 0.25) * 4;
                const r = Math.floor(160 + 95 * t);
                const g = Math.floor(32 - 32 * t);
                const b = Math.floor(240 - 240 * t);
                return `rgb(${r},${g},${b})`;
            } else if (intensity < 0.75) {
                const t = (intensity - 0.5) * 4;
                const r = 255;
                const g = Math.floor(107 * t);
                const b = 0;
                return `rgb(${r},${g},${b})`;
            } else {
                const t = (intensity - 0.75) * 4;
                const r = 255;
                const g = Math.floor(107 + 148 * t);
                const b = 0;
                return `rgb(${r},${g},${b})`;
            }
        }

        function drawFrequencyAxis(ctx, width, height, sampleRate) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.font = '12px monospace';

            const maxFreq = sampleRate / 2;
            const numFreqLabels = 8;
            for (let i = 0; i <= numFreqLabels; i++) {
                const y = height - (i / numFreqLabels) * height;
                const freq = (i / numFreqLabels) * maxFreq;

                // Format Hz nicely
                let freqText = Math.round(freq);
                if (freqText >= 1000) {
                    freqText = (freqText / 1000).toFixed(1) + 'k';
                }

                ctx.fillText(freqText + 'Hz', 5, y - 4);
            }
        }

        function drawTimeLabels(timeLabelsDiv, duration) {
            timeLabelsDiv.innerHTML = '';
            const numTimeLabels = 10;
            for (let i = 0; i <= numTimeLabels; i++) {
                const time = (i / numTimeLabels) * duration;
                const span = document.createElement('span');
                span.textContent = time.toFixed(1) + 's';
                timeLabelsDiv.appendChild(span);
            }
        }

        downloadBtn.addEventListener('click', () => {
            const canvases = canvasContainer.querySelectorAll('canvas');
            const totalHeight = Array.from(canvases).reduce((sum, c) => sum + c.height + 50, 0);
            const maxWidth = Math.max(...Array.from(canvases).map(c => c.width));

            const composite = document.createElement('canvas');
            composite.width = maxWidth;
            composite.height = totalHeight;
            const ctx = composite.getContext('2d');

            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, composite.width, composite.height);

            let yOffset = 0;
            canvases.forEach((canvas) => {
                ctx.drawImage(canvas, 0, yOffset);
                yOffset += canvas.height + 50;
            });

            const link = document.createElement('a');
            link.download = 'spectrogram.png';
            link.href = composite.toDataURL();
            link.click();
        });

        removeBtn.addEventListener('click', () => {
            resetUI();
        });

        function resetUI() {
            fileInput.value = '';
            audioBuffer = null;
            canvasContainer.innerHTML = '';
            canvasContainer.classList.add('hidden');
            fileInfo.classList.add('hidden');
            controlsContainer.classList.add('hidden');
        }
