from flask import Flask, request, jsonify
from flask_cors import CORS
import whisper
import os
import tempfile

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Load Whisper model (you can choose 'tiny', 'base', 'small', 'medium', 'large')
print("Loading Whisper model...")
model = whisper.load_model("base")
print("Model loaded successfully!")

# Allowed audio extensions — INCLUDE 'webm'
ALLOWED_EXTENSIONS = {'wav', 'mp3', 'm4a', 'flac', 'aac', 'ogg', 'wma', 'webm'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "message": "Whisper Transcription API",
        "status": "running",
        "endpoints": {
            "/transcribe": "POST - Upload audio file for transcription"
        }
    })

@app.route('/transcribe', methods=['POST'])
def transcribe_audio():
    print("Request files keys:", request.files.keys())  # Debug: show keys received
    try:
        if 'file' not in request.files:
            return jsonify({"error": "No file provided"}), 400

        file = request.files['file']

        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400

        if not allowed_file(file.filename):
            return jsonify({
                "error": f"File type not supported. Allowed types: {', '.join(ALLOWED_EXTENSIONS)}"
            }), 400

        # Read file content for debug
        content = file.read()
        print(f"Received file: {file.filename}, size: {len(content)} bytes")
        # Reset file pointer after reading
        file.seek(0)

        # Save file temporarily
        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as temp_file:
            file.save(temp_file.name)
            temp_filename = temp_file.name

        try:
            print(f"Transcribing file: {file.filename}")
            result = model.transcribe(temp_filename)
            transcription = result["text"].strip()
            language = result["language"]

            os.unlink(temp_filename)  # Clean up temp file

            return jsonify({
                "transcription": transcription,
                "language": language,
                "filename": file.filename,
                "status": "success"
            })
        except Exception as e:
            if os.path.exists(temp_filename):
                os.unlink(temp_filename)
            return jsonify({"error": f"Transcription failed: {str(e)}"}), 500

    except Exception as e:
        return jsonify({"error": f"Request processing failed: {str(e)}"}), 500

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "model": "whisper-base"})

if __name__ == '__main__':
    print("Starting Whisper Transcription API...")
    print("API available at: http://localhost:5000")
    app.run(debug=True, host='0.0.0.0', port=5000)
