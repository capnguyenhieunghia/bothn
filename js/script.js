// =================================================================
//                      GLOBAL VARIABLES
// =================================================================
let SECRET_KEY;
let abbreviations = {};
let intents = [];
let knowledgeBase = { idf: {}, questions: [], vocabulary: [] };
let extractionContext = null; // { text, corpus, idf }
let notifications = []; // Kept for structure, can be populated if needed

let isMicUsed = false;
let isSpeaking = false;
let isListening = false;

// =================================================================
//                      HELPER FUNCTIONS
// =================================================================

// --- TF-IDF and Vectorization ---
function createCorpus(text) {
    // Create a corpus of sentences from a block of text
    return text.split(/[.!?\n]/).filter(s => s.trim().length > 10).map(s => s.toLowerCase().replace(/[.,/#!$%^&*;:{}=-_`~()]/g, ""));
}

function calculateIDF(corpus) {
    // Calculate Inverse Document Frequency for a given corpus
    const idf = {};
    const docCount = corpus.length;
    if (docCount === 0) return idf;

    const allWords = new Set(corpus.join(' ').split(' ').filter(w => w.length > 1));

    allWords.forEach(word => {
        let docsContainingWord = 0;
        corpus.forEach(doc => {
            if (doc.includes(word)) {
                docsContainingWord++;
            }
        });
        idf[word] = Math.log(docCount / (1 + docsContainingWord)) + 1;
    });
    return idf;
}

function cosineSimilarity(vecA, vecB) {
    const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val ** 2, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val ** 2, 0));
    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    return dotProduct / (magnitudeA * magnitudeB);
}

function vectorizeWithTFIDF(text, vocabulary, idf) {
    const vector = new Array(vocabulary.length).fill(0);
    const words = text.split(' ');
    const wordCount = words.length;
    if (wordCount === 0) return vector;

    const tf = {};
    words.forEach(word => {
        tf[word] = (tf[word] || 0) + 1;
    });

    vocabulary.forEach((vocabWord, i) => {
        if (tf[vocabWord]) {
            const termFrequency = tf[vocabWord] / wordCount;
            const inverseDocFrequency = idf[vocabWord] || 1;
            vector[i] = termFrequency * inverseDocFrequency;
        }
    });
    return vector;
}

// --- Security and Cookies ---
function encryptMessage(message) {
    return CryptoJS.AES.encrypt(message, SECRET_KEY).toString();
}

function decryptMessage(ciphertext) {
    const bytes = CryptoJS.AES.decrypt(ciphertext, SECRET_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
}

function setCookie(name, value, days) {
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${new Date(Date.now() + days * 864e5).toUTCString()}; path=/; Secure; SameSite=Strict`;
}

function getCookie(name) {
    return document.cookie.split('; ').reduce((r, v) => {
        const parts = v.split('=');
        return parts[0] === name ? decodeURIComponent(parts[1]) : r;
    }, '');
}

// =================================================================
//                      INITIAL DATA LOADING
// =================================================================
fetch('config.json')
    .then(response => {
        if (!response.ok) throw new Error('Failed to load config.json');
        return response.json();
    })
    .then(config => {
        SECRET_KEY = config.secret_key;
        return fetch('abbreviations.json');
    })
    .then(response => {
        if (!response.ok) throw new Error('Failed to load abbreviations.json');
        return response.json();
    })
    .then(abbreviationsData => {
        abbreviations = abbreviationsData;
        return fetch('data.json');
    })
    .then(response => {
        if (!response.ok) throw new Error('Failed to load data.json');
        return response.json();
    })
    .then(intentsData => {
        intents = intentsData.intents;
        return fetch('knowledge_base.json');
    })
    .then(response => {
        if (!response.ok) throw new Error('Failed to load knowledge_base.json');
        return response.json();
    })
    .then(kbData => {
        const questions = kbData.qa_pairs.map(pair => pair.question.toLowerCase().replace(/[.,/#!$%^&*;:{}=-_`~()]/g, ""));
        const idf = calculateIDF(questions);
        knowledgeBase.idf = idf;
        knowledgeBase.questions = kbData.qa_pairs.map(pair => ({
            text: pair.question.toLowerCase().replace(/[.,/#!$%^&*;:{}=-_`~()]/g, ""),
            answer: pair.answer
        }));
        knowledgeBase.vocabulary = Object.keys(idf);

        loadChatHistory();
        loadNotifications();
    })
    .catch(error => {
        console.error('Error during initial data loading:', error);
        displayMessage('Rất tiếc, đã có lỗi xảy ra khi tải dữ liệu cần thiết. Vui lòng tải lại trang.', 'bot', new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    });

// =================================================================
//                      CORE CHATBOT FUNCTIONS
// =================================================================

function loadChatHistory() {
    const chatHistory = getCookie('chatHistory');
    if (chatHistory) {
        document.getElementById('messages').innerHTML = chatHistory;
        document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
    }
}

function saveChatHistory() {
    setCookie('chatHistory', document.getElementById('messages').innerHTML, 7);
}

function loadNotifications() {
    if (notifications.length > 0) {
        notifications.forEach(notification => {
            const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            displayMessage(notification, 'bot', timestamp);
        });
    }
}

function displayMessage(message, sender, timestamp) {
    const messages = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;

    const formattedMessage = decryptMessage(encryptMessage(message)).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color: navy; text-decoration: none;">Liên kết</a>');

    messageDiv.innerHTML = `
        <div class="message-bubble">
            <div class="message-text">${formattedMessage}</div>
            <div class="message-footer">
                <span class="sender-name">${sender === 'user' ? 'Bạn' : 'bothn'}</span>
                <span class="timestamp">${timestamp}</span>
            </div>
        </div>`;

    messages.appendChild(messageDiv);
    messages.scrollTop = messages.scrollHeight;
}

function showTypingIndicator() {
    document.getElementById('typing').style.display = 'flex';
}

function hideTypingIndicator() {
    document.getElementById('typing').style.display = 'none';
}

function validateInput(input) {
    const illegalChars = /[<>]/;
    return !illegalChars.test(input);
}

function expandAbbreviations(message) {
    const words = message.split(' ');
    const expandedWords = words.map(word => {
        const normalizedWord = word.toLowerCase().replace(/[.,/#!$%^&*;:{}=-_`~()]/g, "");
        return abbreviations[normalizedWord] || word;
    });
    return expandedWords.join(' ');
}

function solveMath(expression) {
    try {
        const sanitizedExpression = expression.replace(/[^0-9\s\+\-\*\/\(\)\.]/g, '');
        if (sanitizedExpression !== expression) return null;
        const result = new Function('return ' + sanitizedExpression)();
        if (isNaN(result) || !isFinite(result)) return null;
        return result;
    } catch (error) {
        return null;
    }
}

function sendMessage(message) {
    const input = document.getElementById('userInput');
    const normalizedMessage = message.trim();

    if (!validateInput(normalizedMessage)) {
        displayMessage("Đầu vào không hợp lệ!", 'bot', new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        return;
    }
    if (!normalizedMessage) return;

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    displayMessage(normalizedMessage, 'user', timestamp);
    input.value = '';

    if (normalizedMessage.toLowerCase().startsWith('@extract')) {
        displayExtractionOptions();
        return;
    }
     if (normalizedMessage.toLowerCase().startsWith('@clear')) {
        document.getElementById('messages').innerHTML = '';
        saveChatHistory();
        displayMessage('Lịch sử trò chuyện đã được xóa.', 'bot', timestamp);
        return;
    }

    showTypingIndicator();
    const expandedMessage = expandAbbreviations(normalizedMessage);

    setTimeout(() => {
        const response = autoReply(expandedMessage);
        hideTypingIndicator();
        displayMessage(response, 'bot', timestamp);
        saveChatHistory();
        if (isMicUsed) speakText(response);
        isMicUsed = false;
    }, 1000);
}

function autoReply(message) {
    // Priority 1: Answer from extraction context if it exists
    if (extractionContext && extractionContext.corpus.length > 0) {
        const userMessageLower = message.toLowerCase();

        if (['thoát', 'xong', 'cảm ơn', 'đủ rồi', 'kết thúc'].some(word => userMessageLower.includes(word))) {
            extractionContext = null;
            setTimeout(() => displayEndOfExtractionSummary(), 200);
            return; // Return nothing, as the summary card will be displayed
        }

        if (userMessageLower.includes('tóm tắt')) {
            const sentenceScores = extractionContext.corpus.map(sentence => {
                const words = sentence.split(' ');
                let score = 0;
                words.forEach(word => { score += extractionContext.idf[word] || 0; });
                return { sentence, score };
            });
            sentenceScores.sort((a, b) => b.score - a.score);
            const topSentences = sentenceScores.slice(0, 3).map(item => item.sentence);
            return "Đây là tóm tắt những điểm chính từ tài liệu:\n- " + topSentences.join('\n- ');
        }

        const questionWords = new Set(userMessageLower.replace(/[.,/#!$%^&*;:{}=-_`~()]/g, "").split(' ').filter(w => w.length > 1));
        let bestSentence = "Xin lỗi, tôi không tìm thấy thông tin nào phù hợp trong tài liệu được cung cấp.";
        let maxScore = 0;

        extractionContext.corpus.forEach(sentence => {
            let currentScore = 0;
            questionWords.forEach(qWord => {
                if (sentence.includes(qWord)) {
                    currentScore += extractionContext.idf[qWord] || 0;
                }
            });
            if (currentScore > maxScore) {
                maxScore = currentScore;
                bestSentence = sentence.trim();
            }
        });

        if (maxScore > 0.5) return bestSentence;
        return "Xin lỗi, tôi không tìm thấy thông tin nào đủ liên quan đến câu hỏi của bạn trong tài liệu.";
    }

    // Priority 2: Solve math problems
    const mathResult = solveMath(message);
    if (mathResult !== null) {
        return `Kết quả của phép tính là: ${mathResult}`;
    }

    // Priority 3: Handle simple conversational intents
    const normalizedMessage = message.toLowerCase().replace(/[.,/#!$%^&*;:{}=-_`~()]/g, "");
    if (intents && intents.length > 0) {
        for (const intent of intents) {
            for (const pattern of intent.patterns) {
                if (normalizedMessage.includes(pattern)) {
                    return intent.responses[Math.floor(Math.random() * intent.responses.length)];
                }
            }
        }
    }

    // Priority 4: Use TF-IDF to find the best match in the knowledge base
    const userVector = vectorizeWithTFIDF(normalizedMessage, knowledgeBase.vocabulary, knowledgeBase.idf);
    let bestMatch = null;
    let bestScore = 0.1; // Minimum similarity threshold

    knowledgeBase.questions.forEach(q => {
        const questionVector = vectorizeWithTFIDF(q.text, knowledgeBase.vocabulary, knowledgeBase.idf);
        const similarity = cosineSimilarity(userVector, questionVector);
        if (similarity > bestScore) {
            bestScore = similarity;
            bestMatch = q.answer;
        }
    });

    return bestMatch || "Hiện tại tôi chưa thể trả lời câu hỏi của bạn. Bạn có thể thử diễn đạt lại câu hỏi không?";
}


// =================================================================
//                      SPEECH & COMMANDS
// =================================================================

function speakText(text) {
    if (typeof responsiveVoice !== 'undefined') {
        const language = 'Vietnamese Female';
        responsiveVoice.speak(text, language, {
            onstart: () => { isSpeaking = true; document.getElementById('micButton').disabled = true; },
            onend: () => { isSpeaking = false; document.getElementById('micButton').disabled = false; }
        });
    } else {
        console.error('ResponsiveVoice is not loaded.');
    }
}

function startDictation() {
    const micButton = document.getElementById('micButton');
    micButton.classList.add('active');

    if (window.SpeechRecognition || window.webkitSpeechRecognition) {
        const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
        recognition.lang = 'vi-VN';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognition.start();
        isListening = true;

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            isMicUsed = true;
            sendMessage(transcript);
        };
        recognition.onerror = (event) => console.error("Speech recognition error:", event.error);
        recognition.onend = () => {
            micButton.classList.remove('active');
            isListening = false;
        };
    } else {
        alert('Trình duyệt của bạn không hỗ trợ chức năng nhận diện giọng nói.');
    }
}

// --- @ Command Suggestions ---
const commands = [
    { name: '@extract', description: 'Trích xuất thông tin từ file/URL', icon: 'fa-file-import' },
    { name: '@clear', description: 'Xóa lịch sử trò chuyện', icon: 'fa-trash-alt' }
];

const userInput = document.getElementById('userInput');
const suggestionsContainer = document.getElementById('command-suggestions');

userInput.addEventListener('input', () => {
    const value = userInput.value;
    if (value.startsWith('@')) {
        const searchTerm = value.substring(1).toLowerCase();
        const filteredCommands = commands.filter(cmd => cmd.name.toLowerCase().includes(searchTerm));
        renderSuggestions(filteredCommands);
    } else {
        suggestionsContainer.style.display = 'none';
    }
});

function renderSuggestions(filteredCommands) {
    if (filteredCommands.length === 0) {
        suggestionsContainer.style.display = 'none';
        return;
    }
    suggestionsContainer.innerHTML = '';
    filteredCommands.forEach(command => {
        const item = document.createElement('div');
        item.className = 'command-suggestion-item';
        item.innerHTML = `
            <i class="fas ${command.icon}"></i>
            <div class="command-info">
                <span class="command-name">${command.name}</span>
                <span class="command-description">${command.description}</span>
            </div>`;
        item.onclick = () => {
            userInput.value = command.name + ' ';
            suggestionsContainer.style.display = 'none';
            userInput.focus();
        };
        suggestionsContainer.appendChild(item);
    });
    suggestionsContainer.style.display = 'block';
}

// =================================================================
//                      EXTRACTION FEATURE
// =================================================================

function displayExtractionOptions() {
    const messages = document.getElementById('messages');
    const optionCard = document.createElement('div');
    optionCard.className = 'message bot-message';
    optionCard.innerHTML = `
        <div class="message-bubble">
            <div class="extraction-card">
                <h4>Trích xuất thông tin</h4>
                <p>Vui lòng chọn nguồn để tôi có thể quét và trả lời câu hỏi của bạn.</p>
                <div class="extraction-buttons">
                    <button class="extraction-btn" onclick="triggerFileUpload()"><i class="fas fa-upload"></i> Tải lên File</button>
                    <button class="extraction-btn" onclick="promptForURL()"><i class="fas fa-link"></i> Nhập URL</button>
                </div>
            </div>
        </div>`;
    messages.appendChild(optionCard);
    messages.scrollTop = messages.scrollHeight;

    let fileInput = document.getElementById('hidden-file-input');
    if (!fileInput) {
        fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.id = 'hidden-file-input';
        fileInput.style.display = 'none';
        fileInput.accept = ".txt,.docx,.xlsx";
        fileInput.onchange = handleFileUpload;
        document.body.appendChild(fileInput);
    }
}

function displayEndOfExtractionSummary() {
    const messages = document.getElementById('messages');
    const summaryCard = document.createElement('div');
    summaryCard.className = 'message bot-message';
    summaryCard.innerHTML = `
        <div class="message-bubble">
            <div class="summary-card">
                <h4><i class="fas fa-check-circle"></i>Phiên hỏi đáp đã kết thúc</h4>
                <p>Tôi đã xóa nội dung của tài liệu khỏi bộ nhớ tạm.</p>
                <p class="next-step-prompt">Bạn muốn làm gì tiếp theo?</p>
                <div class="summary-buttons">
                    <button class="summary-btn" onclick="displayExtractionOptions()"><i class="fas fa-file-import"></i> Trích xuất tài liệu khác</button>
                    <button class="summary-btn" onclick="sendMessage('làm thế nào để học tập hiệu quả')"><i class="fas fa-graduation-cap"></i> Hỏi một câu ngẫu nhiên</button>
                </div>
            </div>
        </div>`;
    messages.appendChild(summaryCard);
    messages.scrollTop = messages.scrollHeight;
}

function triggerFileUpload() {
    document.getElementById('hidden-file-input').click();
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    displayMessage(`Đang phân tích file: ${file.name}...`, 'bot', timestamp);
    const reader = new FileReader();
    reader.onload = function(e) {
        const fileContent = e.target.result;
        let promise;
        if (file.name.endsWith('.docx')) {
            promise = mammoth.extractRawText({ arrayBuffer: fileContent }).then(result => result.value);
        } else if (file.name.endsWith('.xlsx')) {
            promise = new Promise((resolve) => {
                const workbook = XLSX.read(fileContent, { type: 'array' });
                let fullText = '';
                workbook.SheetNames.forEach(sheetName => {
                    const worksheet = workbook.Sheets[sheetName];
                    const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                    json.forEach(row => { fullText += row.join(' ') + '\n'; });
                });
                resolve(fullText);
            });
        } else if (file.name.endsWith('.txt')) {
            promise = Promise.resolve(new TextDecoder("utf-8").decode(fileContent));
        } else {
            displayMessage('Xin lỗi, tôi chưa hỗ trợ định dạng file này. Vui lòng thử file .txt, .docx, hoặc .xlsx.', 'bot', timestamp);
            return;
        }
        promise.then(text => {
            const corpus = createCorpus(text);
            const idf = calculateIDF(corpus);
            extractionContext = { text: text, corpus: corpus, idf: idf };
            displayMessage('Tôi đã phân tích xong nội dung. Bây giờ bạn có thể đặt câu hỏi hoặc yêu cầu "tóm tắt".', 'bot', timestamp);
        }).catch(err => {
            console.error("Error processing file:", err);
            displayMessage('Đã có lỗi xảy ra khi xử lý file.', 'bot', timestamp);
        });
    };
    reader.readAsArrayBuffer(file);
}

function promptForURL() {
    const url = prompt("Vui lòng nhập URL của trang web:");
    if (!url) return;
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    displayMessage(`Đang lấy dữ liệu từ URL: ${url}...`, 'bot', timestamp);
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    fetch(proxyUrl)
        .then(response => {
            if (!response.ok) throw new Error('Network response was not ok');
            return response.text();
        })
        .then(html => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            doc.querySelectorAll('script, style').forEach(el => el.remove());
            const text = (doc.body.innerText || "").replace(/\s\s+/g, ' ').trim();
            const corpus = createCorpus(text);
            const idf = calculateIDF(corpus);
            extractionContext = { text: text, corpus: corpus, idf: idf };
            displayMessage('Tôi đã phân tích xong nội dung. Bây giờ bạn có thể đặt câu hỏi hoặc yêu cầu "tóm tắt".', 'bot', timestamp);
        })
        .catch(err => {
            console.error("Error fetching URL:", err);
            displayMessage('Rất tiếc, tôi không thể truy cập hoặc xử lý URL này.', 'bot', timestamp);
        });
}

// =================================================================
//                      EVENT LISTENERS
// =================================================================

document.getElementById('userInput').addEventListener('keypress', function (event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        sendMessage(this.value);
    }
});

document.getElementById('micButton').addEventListener('click', function () {
    if (!isSpeaking && !isListening) {
        startDictation();
    }
});

document.addEventListener('click', function(event) {
    if (!userInput.contains(event.target) && !suggestionsContainer.contains(event.target)) {
        suggestionsContainer.style.display = 'none';
    }
});

window.onload = function () {
    // Data is already being loaded by the main fetch chain
};
