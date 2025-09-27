function sanitizeInput(input) {
    const element = document.createElement('div');
    element.innerText = input;
    return element.innerHTML;
}

function generateCsrfToken() {
    return crypto.randomUUID();
}

function validateCsrfToken(clientToken, serverToken) {
    return clientToken === serverToken;
}

const csrfToken = generateCsrfToken();

function checkToken(clientToken) {
    if (validateCsrfToken(clientToken, csrfToken)) {
        console.log("Token hợp lệ, tiếp tục xử lý yêu cầu.");
    } else {
        console.log("Token không hợp lệ, từ chối yêu cầu.");
        alert("Yêu cầu không hợp lệ!");
    }
}

const userInput = '<script>alert("XSS")</script>';
const safeInput = sanitizeInput(userInput);
console.log(safeInput);
function logSuspiciousActivity(activity) {
    console.log(`Suspicious activity detected: ${activity}`);
}