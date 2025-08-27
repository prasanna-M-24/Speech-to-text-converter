import React, { useState, useRef, useEffect } from 'react';

function App() {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState('');
  const [history, setHistory] = useState([]);
  const [selectedHistory, setSelectedHistory] = useState(null);
  const [uploadController, setUploadController] = useState(null);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const audioRef = useRef(null);

  // Load history from localStorage on component mount
  useEffect(() => {
    const savedHistory = localStorage.getItem('speechToTextHistory');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (error) {
        console.error('Failed to load history from localStorage:', error);
      }
    }
  }, []);

  // Save history to localStorage whenever it changes
  useEffect(() => {
    if (history.length > 0) {
      localStorage.setItem('speechToTextHistory', JSON.stringify(history));
    }
  }, [history]);

  // Timer for recording duration
  useEffect(() => {
    if (recording) {
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
      setRecordingTime(0);
    }
    return () => clearInterval(timerRef.current);
  }, [recording]);

  // Format time display
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Start recording audio from mic
  const startRecording = async () => {
    setError('');
    setSuccess(false);
    setTranscript('');
    setAudioUrl('');
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        }
      });
      
      mediaRecorderRef.current = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        await sendAudioToBackend(audioBlob, 'recorded_audio.webm', url);
        
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current.start(1000); // Collect data every second
      setRecording(true);
    } catch (err) {
      setError(`Microphone error: ${err.message}`);
    }
  };

  // Stop recording audio
  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  };

  // Handle audio file upload
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('audio/')) {
        setError('Please select a valid audio file');
        return;
      }
      
      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        setError('File size must be less than 10MB');
        return;
      }

      setError('');
      setSuccess(false);
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      await sendAudioToBackend(file, file.name, url);
    }
  };

  // Send audio blob or file to backend
  const sendAudioToBackend = async (audioFile, filename, audioUrl) => {
    setLoading(true);
    setTranscript('');
    
    const controller = new AbortController();
    setUploadController(controller);
    
    const formData = new FormData();
    formData.append('file', audioFile, filename);

    try {
      // Replace with your actual backend URL
      const response = await fetch('http://localhost:5000/transcribe', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();
      const transcription = data.transcription || data.text || 'No transcription available';
      
      setTranscript(transcription);
      setSuccess(true);
      
      // Add to history with preserved audio URL
      const historyItem = {
        id: Date.now(),
        timestamp: new Date().toLocaleString(),
        text: transcription,
        filename: filename,
        audioUrl: audioUrl, // Store the blob URL for persistence
        wordCount: transcription.split(/\s+/).filter(word => word.length > 0).length,
        charCount: transcription.length
      };
      setHistory(prev => [historyItem, ...prev].slice(0, 10)); // Keep last 10 items
      
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Upload cancelled');
      } else {
        const errorMessage = err.message || 'Failed to transcribe audio';
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
      setUploadController(null);
    }
  };

  // Cancel upload/transcription
  const cancelUpload = () => {
    if (uploadController) {
      uploadController.abort();
      setUploadController(null);
      setLoading(false);
    }
  };

  // Copy transcript to clipboard
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(transcript);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError('Failed to copy to clipboard');
    }
  };

  // Download transcript as text file
  const downloadTranscript = () => {
    const element = document.createElement('a');
    const file = new Blob([transcript], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `transcript_${new Date().toISOString().slice(0, 10)}.txt`;
    element.click();
  };

  // Clear current transcript and audio
  const clearCurrent = () => {
    setTranscript('');
    setAudioUrl('');
    setError('');
    setSuccess(false);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
  };

  // Clear all history
  const clearHistory = () => {
    // Revoke all blob URLs to prevent memory leaks
    history.forEach(item => {
      if (item.audioUrl && item.audioUrl.startsWith('blob:')) {
        URL.revokeObjectURL(item.audioUrl);
      }
    });
    setHistory([]);
    localStorage.removeItem('speechToTextHistory');
    setSelectedHistory(null);
  };

  // Load from history
  const loadFromHistory = (item) => {
    setTranscript(item.text);
    setAudioUrl(item.audioUrl);
    setSelectedHistory(item.id);
    setError('');
    setSuccess(false);
  };

  // Get word and character count
  const getStats = (text) => {
    const wordCount = text.split(/\s+/).filter(word => word.length > 0).length;
    const charCount = text.length;
    return { wordCount, charCount };
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #e0f2fe 0%, #e8eaf6 100%)', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#1f2937', marginBottom: '0.5rem', margin: 0 }}>
            Jansaathi Speech to Text
          </h1>
          <p style={{ color: '#6b7280', fontSize: '1.1rem', margin: '0.5rem 0 0 0' }}>
            Convert speech to text with high accuracy
          </p>
        </div>

        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          
          {/* Main Content */}
          <div style={{ flex: '2', minWidth: '300px' }}>
            
            {/* Recording Section */}
            <div style={{ 
              background: 'white', 
              borderRadius: '1rem', 
              boxShadow: '0 10px 25px rgba(0,0,0,0.1)', 
              padding: '2rem',
              marginBottom: '2rem'
            }}>
              <h2 style={{ 
                fontSize: '1.5rem', 
                fontWeight: '600', 
                color: '#1f2937', 
                textAlign: 'center', 
                marginBottom: '2rem',
                margin: '0 0 2rem 0'
              }}>
                Record Audio
              </h2>
              
              {/* Recording Button */}
              <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                <button
                  onClick={recording ? stopRecording : startRecording}
                  disabled={loading}
                  aria-label={recording ? 'Stop recording' : 'Start recording'}
                  style={{
                    width: '100px',
                    height: '100px',
                    borderRadius: '50%',
                    border: 'none',
                    fontSize: '2rem',
                    color: 'white',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    background: recording ? '#ef4444' : '#3b82f6',
                    transition: 'all 0.3s ease',
                    opacity: loading ? 0.5 : 1,
                    animation: recording ? 'pulse 2s infinite' : 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  onMouseOver={(e) => {
                    if (!loading) {
                      e.target.style.transform = 'scale(1.05)';
                    }
                  }}
                  onMouseOut={(e) => {
                    e.target.style.transform = 'scale(1)';
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      recording ? stopRecording() : startRecording();
                    }
                  }}
                >
                  {recording ? '⏹️' : '🎤'}
                </button>
                
                <div style={{ marginTop: '1rem' }}>
                  <p style={{ color: '#6b7280', margin: '0 0 0.5rem 0' }}>
                    {recording ? 'Click to stop recording' : 'Click to start recording'}
                  </p>
                  {recording && (
                    <div style={{ color: '#ef4444', fontSize: '1.2rem', fontFamily: 'monospace', fontWeight: 'bold' }}>
                      Recording: {formatTime(recordingTime)}
                    </div>
                  )}
                </div>
              </div>

              {/* OR Divider */}
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                margin: '2rem 0',
                color: '#9ca3af'
              }}>
                <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }}></div>
                <span style={{ padding: '0 1rem', fontSize: '0.9rem', fontWeight: '500' }}>OR</span>
                <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }}></div>
              </div>

              {/* File Upload */}
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  border: '2px dashed #d1d5db',
                  borderRadius: '0.75rem',
                  padding: '2rem',
                  background: '#f9fafb',
                  transition: 'border-color 0.3s ease',
                  cursor: 'pointer',
                  maxWidth: '400px',
                  margin: '0 auto'
                }}
                onMouseOver={(e) => e.target.style.borderColor = '#3b82f6'}
                onMouseOut={(e) => e.target.style.borderColor = '#d1d5db'}
                >
                  <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📁</div>
                  <label style={{ cursor: 'pointer', display: 'block' }}>
                    <span style={{ 
                      color: '#3b82f6', 
                      fontSize: '1.1rem', 
                      fontWeight: '500',
                      textDecoration: 'underline'
                    }}>
                      Click to upload an audio file
                    </span>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={handleFileUpload}
                      style={{ display: 'none' }}
                      disabled={loading || recording}
                    />
                  </label>
                  <p style={{ color: '#6b7280', fontSize: '0.9rem', margin: '0.5rem 0 0 0' }}>
                    MP3, WAV, M4A up to 10MB
                  </p>
                </div>
              </div>

              {/* Audio Player */}
              {audioUrl && (
                <div style={{ 
                  marginTop: '2rem', 
                  padding: '1.5rem', 
                  background: '#f3f4f6', 
                  borderRadius: '0.75rem',
                  maxWidth: '500px',
                  margin: '2rem auto 0 auto'
                }}>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    marginBottom: '1rem' 
                  }}>
                    <span style={{ fontSize: '1.1rem', fontWeight: '500', color: '#374151', marginRight: '0.5rem' }}>
                      Audio Preview
                    </span>
                    <span style={{ fontSize: '1.2rem' }}>🔊</span>
                  </div>
                  <audio
                    ref={audioRef}
                    src={audioUrl}
                    controls
                    style={{ width: '100%' }}
                    preload="metadata"
                  />
                </div>
              )}

              {/* Status Messages */}
              {loading && (
                <div style={{ 
                  marginTop: '1.5rem', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  padding: '1rem', 
                  background: '#dbeafe', 
                  borderRadius: '0.5rem',
                  maxWidth: '400px',
                  margin: '1.5rem auto 0 auto'
                }}>
                  <div style={{
                    width: '20px',
                    height: '20px',
                    border: '2px solid #2563eb',
                    borderTop: '2px solid transparent',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                    marginRight: '0.5rem'
                  }}></div>
                  <span style={{ color: '#1d4ed8', marginRight: '1rem' }}>Transcribing audio...</span>
                  <button
                    onClick={cancelUpload}
                    style={{
                      background: '#ef4444',
                      color: 'white',
                      border: 'none',
                      borderRadius: '0.25rem',
                      padding: '0.25rem 0.5rem',
                      fontSize: '0.8rem',
                      cursor: 'pointer'
                    }}
                    aria-label="Cancel transcription"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {error && (
                <div style={{ 
                  marginTop: '1.5rem', 
                  display: 'flex', 
                  alignItems: 'center',
                  padding: '1rem', 
                  background: '#fef2f2', 
                  borderRadius: '0.5rem',
                  maxWidth: '400px',
                  margin: '1.5rem auto 0 auto'
                }}>
                  <span style={{ fontSize: '1.2rem', marginRight: '0.5rem' }}>❌</span>
                  <span style={{ color: '#b91c1c' }}>{error}</span>
                </div>
              )}

              {success && !error && !loading && (
                <div style={{ 
                  marginTop: '1.5rem', 
                  display: 'flex', 
                  alignItems: 'center',
                  padding: '1rem', 
                  background: '#f0fdf4', 
                  borderRadius: '0.5rem',
                  maxWidth: '400px',
                  margin: '1.5rem auto 0 auto'
                }}>
                  <span style={{ fontSize: '1.2rem', marginRight: '0.5rem' }}>✅</span>
                  <span style={{ color: '#166534' }}>Transcription completed successfully!</span>
                </div>
              )}
            </div>

            {/* Transcript Display */}
            {transcript && (
              <div style={{ 
                background: 'white', 
                borderRadius: '1rem', 
                boxShadow: '0 10px 25px rgba(0,0,0,0.1)', 
                padding: '2rem'
              }}>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  marginBottom: '1.5rem',
                  flexWrap: 'wrap',
                  gap: '1rem'
                }}>
                  <h2 style={{ 
                    fontSize: '1.5rem', 
                    fontWeight: '600', 
                    color: '#1f2937',
                    margin: 0
                  }}>
                    Transcribed Text
                  </h2>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      onClick={copyToClipboard}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '0.5rem 1rem',
                        background: '#dbeafe',
                        color: '#1d4ed8',
                        border: 'none',
                        borderRadius: '0.5rem',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        fontWeight: '500',
                        transition: 'background-color 0.2s'
                      }}
                      onMouseOver={(e) => e.target.style.background = '#bfdbfe'}
                      onMouseOut={(e) => e.target.style.background = '#dbeafe'}
                    >
                      <span style={{ marginRight: '0.5rem' }}>📋</span>
                      Copy
                    </button>
                    <button
                      onClick={downloadTranscript}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '0.5rem 1rem',
                        background: '#dcfce7',
                        color: '#166534',
                        border: 'none',
                        borderRadius: '0.5rem',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        fontWeight: '500',
                        transition: 'background-color 0.2s'
                      }}
                      onMouseOver={(e) => e.target.style.background = '#bbf7d0'}
                      onMouseOut={(e) => e.target.style.background = '#dcfce7'}
                    >
                      <span style={{ marginRight: '0.5rem' }}>⬇️</span>
                      Download
                    </button>
                    <button
                      onClick={clearCurrent}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '0.5rem 1rem',
                        background: '#fef2f2',
                        color: '#b91c1c',
                        border: 'none',
                        borderRadius: '0.5rem',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        fontWeight: '500',
                        transition: 'background-color 0.2s'
                      }}
                      onMouseOver={(e) => e.target.style.background = '#fecaca'}
                      onMouseOut={(e) => e.target.style.background = '#fef2f2'}
                    >
                      <span style={{ marginRight: '0.5rem' }}>🗑️</span>
                      Clear
                    </button>
                  </div>
                </div>
                <div style={{ 
                  background: '#f9fafb', 
                  borderRadius: '0.5rem', 
                  padding: '1.5rem', 
                  maxHeight: '300px', 
                  overflowY: 'auto',
                  border: '1px solid #e5e7eb'
                }}>
                  <p style={{ 
                    color: '#1f2937', 
                    whiteSpace: 'pre-wrap', 
                    lineHeight: '1.6', 
                    fontSize: '1.1rem',
                    margin: 0
                  }}>
                    {transcript}
                  </p>
                </div>
                <div style={{ 
                  marginTop: '1rem', 
                  fontSize: '0.95rem', 
                  color: '#374151', 
                  textAlign: 'center',
                  padding: '0.75rem',
                  background: '#f3f4f6',
                  borderRadius: '0.5rem',
                  border: '1px solid #e5e7eb'
                }}>
                  <strong>📊 Statistics:</strong> {getStats(transcript).charCount} characters • {getStats(transcript).wordCount} words
                </div>
              </div>
            )}
          </div>

          {/* History Sidebar */}
          <div style={{ flex: '1', minWidth: '280px' }}>
            <div style={{ 
              background: 'white', 
              borderRadius: '1rem', 
              boxShadow: '0 10px 25px rgba(0,0,0,0.1)', 
              padding: '1.5rem',
              position: 'sticky',
              top: '2rem'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1.5rem'
              }}>
                <h2 style={{ 
                  fontSize: '1.3rem', 
                  fontWeight: '600', 
                  color: '#1f2937', 
                  margin: '0'
                }}>
                  Recent Transcriptions
                </h2>
                {history.length > 0 && (
                  <button
                    onClick={clearHistory}
                    style={{
                      background: '#fef2f2',
                      color: '#b91c1c',
                      border: 'none',
                      borderRadius: '0.375rem',
                      padding: '0.375rem 0.75rem',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      fontWeight: '500'
                    }}
                    aria-label="Clear all history"
                    onMouseOver={(e) => e.target.style.background = '#fecaca'}
                    onMouseOut={(e) => e.target.style.background = '#fef2f2'}
                  >
                    Clear All
                  </button>
                )}
              </div>
              {history.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📝</div>
                  <p style={{ color: '#6b7280', margin: 0 }}>No transcriptions yet</p>
                </div>
              ) : (
                <div style={{ 
                  maxHeight: '400px', 
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem'
                }}>
                  {history.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => loadFromHistory(item)}
                      tabIndex={0}
                      role="button"
                      aria-label={`Load transcription from ${item.filename}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          loadFromHistory(item);
                        }
                      }}
                      style={{
                        padding: '1rem',
                        borderRadius: '0.5rem',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        border: selectedHistory === item.id ? '2px solid #3b82f6' : '1px solid transparent',
                        background: selectedHistory === item.id ? '#dbeafe' : '#f9fafb',
                        outline: 'none'
                      }}
                      onMouseOver={(e) => {
                        if (selectedHistory !== item.id) {
                          e.target.style.background = '#f3f4f6';
                          e.target.style.borderColor = '#d1d5db';
                        }
                      }}
                      onMouseOut={(e) => {
                        if (selectedHistory !== item.id) {
                          e.target.style.background = '#f9fafb';
                          e.target.style.borderColor = 'transparent';
                        }
                      }}
                      onFocus={(e) => {
                        e.target.style.boxShadow = '0 0 0 2px rgba(59, 130, 246, 0.5)';
                      }}
                      onBlur={(e) => {
                        e.target.style.boxShadow = 'none';
                      }}
                    >
                      <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.5rem' }}>
                        {item.timestamp}
                      </div>
                      <div style={{ 
                        fontSize: '0.9rem', 
                        fontWeight: '500', 
                        color: '#374151', 
                        marginBottom: '0.5rem',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {item.filename}
                      </div>
                      <div style={{ 
                        fontSize: '0.8rem', 
                        color: '#6b7280',
                        lineHeight: '1.4',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        marginBottom: '0.5rem'
                      }}>
                        {item.text.substring(0, 80)}...
                      </div>
                      <div style={{ 
                        fontSize: '0.7rem', 
                        color: '#9ca3af',
                        fontWeight: '500'
                      }}>
                        {item.charCount || item.text.length} chars • {item.wordCount || getStats(item.text).wordCount} words
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        @media (max-width: 768px) {
          .main-container {
            flex-direction: column !important;
          }
          
          /* Mobile-friendly button sizes */
          .record-button {
            width: 80px !important;
            height: 80px !important;
            font-size: 1.5rem !important;
          }
          
          /* Stack transcript action buttons on mobile */
          .transcript-actions {
            flex-direction: column !important;
            gap: 0.5rem !important;
          }
          
          .transcript-actions button {
            width: 100% !important;
            justify-content: center !important;
          }
        }
        
        @media (max-width: 480px) {
          /* Even smaller screens */
          .main-container {
            padding: 1rem 0.5rem !important;
          }
          
          .card-padding {
            padding: 1.5rem !important;
          }
          
          .header-title {
            font-size: 2rem !important;
          }
        }
      `}</style>
    </div>
  );
}

export default App;