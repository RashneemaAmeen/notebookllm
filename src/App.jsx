import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, FileText, Sun, Moon, Key, Send, 
  CheckCircle2, AlertCircle, Loader2, BookOpen, Trash2, ExternalLink,
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut
} from 'lucide-react';

export default function App() {
  // === State Management ===
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [isKeyConnected, setIsKeyConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [showForceConnect, setShowForceConnect] = useState(false);
  
  const [pdfs, setPdfs] = useState([]);
  const [activePdfId, setActivePdfId] = useState(null);
  const [pdfjsLoaded, setPdfjsLoaded] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);

  // PDF rendering state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [zoomScale, setZoomScale] = useState(1.2);
  const [renderingPage, setRenderingPage] = useState(false);

  const [chatMessages, setChatMessages] = useState([]);
  const [currentInput, setCurrentInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  const chatEndRef = useRef(null);
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);

  // === Load PDF.js dynamically ===
  useEffect(() => {
    if (!document.getElementById('pdfjs-script')) {
      const script = document.createElement('script');
      script.id = 'pdfjs-script';
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        setPdfjsLoaded(true);
      };
      document.body.appendChild(script);
    } else {
      setPdfjsLoaded(true);
    }
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Reset page number on PDF change
  useEffect(() => {
    setCurrentPage(1);
  }, [activePdfId]);

  const activePdf = pdfs.find(p => p.id === activePdfId);

  // === Custom PDF Canvas Rendering ===
  useEffect(() => {
    if (!pdfjsLoaded || !activePdf) return;

    let isCurrent = true;

    const renderPdfPage = async () => {
      setRenderingPage(true);
      try {
        // Cancel any ongoing render task to prevent overlapping frames
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
        }

        const loadingTask = window.pdfjsLib.getDocument(activePdf.dataUrl);
        const pdf = await loadingTask.promise;
        
        if (!isCurrent) return;
        setTotalPages(pdf.numPages);

        const page = await pdf.getPage(currentPage);
        if (!isCurrent) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        const viewport = page.getViewport({ scale: zoomScale });

        // Set high-DPI scaling for crisp text rendering
        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = viewport.width * pixelRatio;
        canvas.height = viewport.height * pixelRatio;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        context.scale(pixelRatio, pixelRatio);

        const renderContext = {
          canvasContext: context,
          viewport: viewport
        };

        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;
        
        await renderTask.promise;
      } catch (error) {
        if (error.name !== 'RenderingCancelledException') {
          console.error("Error rendering PDF on canvas:", error);
        }
      } finally {
        if (isCurrent) setRenderingPage(false);
      }
    };

    renderPdfPage();

    return () => {
      isCurrent = false;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, [activePdf, currentPage, zoomScale, pdfjsLoaded]);

  // === API Key Validation ===
  const handleConnectKey = async () => {
    const cleanedKey = apiKey.trim().replace(/^["']|["']$/g, '').replace(/[\r\n]/g, '');
    
    if (!cleanedKey) {
      setConnectionError('API key cannot be empty.');
      return;
    }

    if (!cleanedKey.startsWith('AIzaSy')) {
      setConnectionError('Warning: Gemini API Keys from Google AI Studio typically start with "AIzaSy". Please check if you copied the correct key.');
      setShowForceConnect(true);
      return;
    }
    
    setIsConnecting(true);
    setConnectionError('');
    setShowForceConnect(false);
    
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${cleanedKey}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const responseData = await res.json();

      if (res.ok) {
        setIsKeyConnected(true);
        setConnectionError('');
      } else {
        setIsKeyConnected(false);
        const errorCode = responseData.error?.status || 'ERROR';
        const errorMsg = responseData.error?.message || 'Invalid API Key response';
        
        if (errorCode === 'INVALID_ARGUMENT' || errorMsg.includes('not valid')) {
          setConnectionError('Google rejected this key. Please verify you copied the entire string from Google AI Studio (e.g., no trailing dots or truncated characters).');
        } else {
          setConnectionError(`${errorCode}: ${errorMsg}`);
        }
        setShowForceConnect(true);
        console.error('API Key validation failed:', responseData.error);
      }
    } catch (error) {
      setIsKeyConnected(false);
      setConnectionError('Network connection failed. Google APIs might be blocked by browser security settings, ad blockers, or network proxy.');
      setShowForceConnect(true);
      console.error('Connection error:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleForceConnect = () => {
    setIsKeyConnected(true);
    setConnectionError('');
    setShowForceConnect(false);
  };

  // === PDF Text Extraction (for chatbot indexing) ===
  const extractTextFromPDF = async (dataUrl) => {
    if (!window.pdfjsLib) throw new Error("PDF.js not loaded yet");
    
    const loadingTask = window.pdfjsLib.getDocument(dataUrl);
    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;
    let textByPage = [];
    
    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const text = textContent.items.map(item => item.str).join(' ');
      textByPage.push({ page: i, text });
    }
    return textByPage;
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    setIsExtracting(true);
    setConnectionError('');
    for (const file of files) {
      if (file.type !== 'application/pdf') {
        setConnectionError(`${file.name} is not a PDF.`);
        continue;
      }

      const reader = new FileReader();
      reader.onload = async (event) => {
        const dataUrl = event.target.result;
        try {
          const textData = await extractTextFromPDF(dataUrl);
          const newPdf = {
            id: crypto.randomUUID(),
            name: file.name,
            dataUrl: dataUrl,
            textByPage: textData
          };
          setPdfs(prev => [...prev, newPdf]);
          if (!activePdfId) setActivePdfId(newPdf.id);
        } catch (error) {
          console.error("Error extracting PDF text:", error);
          setConnectionError(`Failed to read text from ${file.name}`);
        }
      };
      reader.readAsDataURL(file);
    }
    setIsExtracting(false);
  };

  // === Chat Logic ===
  const handleSendMessage = async (e) => {
    e.preventDefault();
    const cleanedKey = apiKey.trim().replace(/^["']|["']$/g, '').replace(/[\r\n]/g, '');
    if (!currentInput.trim() || !isKeyConnected || !activePdf || !cleanedKey) return;

    const userMessage = currentInput.trim();
    setCurrentInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsChatLoading(true);

    const contextString = activePdf.textByPage
      .map(p => `--- Page ${p.page} ---\n${p.text}`)
      .join('\n\n');

    const systemPrompt = `
      You are an AI assistant helping a user understand a PDF document named "${activePdf.name}".
      Here is the extracted text of the document organized by page:
      
      ${contextString}
      
      INSTRUCTIONS:
      1. Answer the user's question based strictly on the document text provided above.
      2. If the answer is not in the document, politely state that you cannot find the information in the current document.
      3. CRITICAL: For every fact or piece of information you provide, you MUST cite the specific page number it came from at the end of the sentence or paragraph (e.g., "The revenue grew by 20% [Page 4].").
      4. Be concise and helpful.
    `;

    const payload = {
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        ...chatMessages.map(msg => ({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }]
        })),
        { role: 'user', parts: [{ text: userMessage }] }
      ]
    };

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${cleanedKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error.message);

      const botReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't generate a response.";
      setChatMessages(prev => [...prev, { role: 'model', content: botReply }]);
    } catch (error) {
      console.error("Chat Error:", error);
      setChatMessages(prev => [...prev, { role: 'model', content: `*Error:* ${error.message}` }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const removePdf = (id, e) => {
    e.stopPropagation();
    setPdfs(prev => prev.filter(p => p.id !== id));
    if (activePdfId === id) setActivePdfId(null);
    if (pdfs.length === 1) setChatMessages([]);
  };

  // === Styling Constants ===
  const baseClasses = isDarkMode ? "dark" : "";
  const containerClasses = "min-h-screen bg-[#f9f9f9] dark:bg-[#121212] text-gray-800 dark:text-gray-200 transition-colors duration-200 flex flex-col font-sans";
  const borderClass = "border-gray-200 dark:border-[#2a2a2a]";
  const headerClass = `h-16 border-b ${borderClass} bg-white dark:bg-[#1e1e1e] flex items-center justify-between px-6 shrink-0`;

  return (
    <div className={baseClasses}>
      <div className={containerClasses}>
        
        {/* HEADER */}
        <header className={headerClass}>
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center text-white font-bold">
              <BookOpen size={18} />
            </div>
            <h1 className="font-semibold text-lg tracking-tight">Notebook AI</h1>
          </div>

          <div className="flex items-center space-x-6">
            {/* API Key Input */}
            <div className="flex items-center bg-gray-100 dark:bg-[#2a2a2a] rounded-full p-1 pr-2 border border-transparent focus-within:border-gray-300 dark:focus-within:border-gray-600 transition-all">
              <div className="pl-3 pr-2 text-gray-400">
                <Key size={16} />
              </div>
              <input
                type="password"
                placeholder="Gemini API Key..."
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setIsKeyConnected(false);
                  setConnectionError('');
                  setShowForceConnect(false);
                }}
                className="bg-transparent border-none outline-none text-sm w-48 text-gray-700 dark:text-gray-200 placeholder-gray-400"
              />
              <button 
                onClick={handleConnectKey}
                disabled={isConnecting || !apiKey.trim() || isKeyConnected}
                className={`ml-2 px-3 py-1 text-xs font-medium rounded-full transition-all duration-300 flex items-center space-x-1
                  ${isKeyConnected 
                    ? 'bg-green-500/15 text-green-500 border border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.6)] animate-pulse' 
                    : 'bg-white dark:bg-[#3f3f3f] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#4a4a4a] shadow-sm'
                  }
                  ${isConnecting ? 'opacity-70 cursor-not-allowed' : ''}
                `}
              >
                {isConnecting ? <Loader2 size={14} className="animate-spin" /> : 
                 isKeyConnected ? <CheckCircle2 size={14} /> : 
                 <span>Connect</span>}
              </button>
            </div>

            {/* Dark Mode Toggle */}
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-[#2a2a2a] text-gray-500 transition-colors"
            >
              {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
        </header>

        {/* ERROR BOX */}
        {connectionError && (
          <div className="bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 border-b border-red-200 dark:border-red-900/50 py-3 px-6 text-sm shrink-0">
            <div className="flex items-start space-x-3">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-semibold">Connection Error:</p>
                <p className="opacity-90 mt-0.5">{connectionError}</p>
                <div className="mt-2.5 text-xs flex items-center space-x-4">
                  <a 
                    href="https://aistudio.google.com/" 
                    target="_blank" 
                    rel="noreferrer" 
                    className="underline hover:opacity-80 flex items-center space-x-1 font-medium text-blue-600 dark:text-blue-400"
                  >
                    <span>Get a Key from Google AI Studio</span>
                    <ExternalLink size={12} />
                  </a>
                  
                  {showForceConnect && (
                    <button 
                      onClick={handleForceConnect}
                      className="px-2.5 py-1 bg-amber-500 text-white dark:bg-amber-600 rounded font-semibold hover:bg-amber-600 transition-colors animate-pulse"
                    >
                      Bypass & Force Connect
                    </button>
                  )}

                  <button 
                    onClick={() => setConnectionError('')}
                    className="underline hover:opacity-80 font-medium text-gray-500"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MAIN LAYOUT */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* LEFT SIDEBAR: PDF List */}
          <aside className={`w-64 border-r ${borderClass} bg-white dark:bg-[#1e1e1e] flex flex-col`}>
            <div className={`p-4 border-b ${borderClass}`}>
              <label className="flex items-center justify-center w-full space-x-2 bg-gray-50 hover:bg-gray-100 dark:bg-[#2a2a2a] dark:hover:bg-[#333] border border-dashed border-gray-300 dark:border-gray-600 rounded-lg py-4 cursor-pointer transition-colors">
                {isExtracting ? (
                  <Loader2 size={20} className="text-blue-500 animate-spin" />
                ) : (
                  <>
                    <Upload size={20} className="text-gray-500" />
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Upload PDFs</span>
                  </>
                )}
                <input 
                  type="file" 
                  accept="application/pdf" 
                  multiple 
                  className="hidden" 
                  onChange={handleFileUpload}
                  disabled={!pdfjsLoaded || isExtracting}
                />
              </label>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {pdfs.length === 0 && (
                <div className="text-center text-sm text-gray-400 mt-10">
                  No documents uploaded yet.
                </div>
              )}
              {pdfs.map(pdf => (
                <div 
                  key={pdf.id}
                  onClick={() => setActivePdfId(pdf.id)}
                  className={`group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                    activePdfId === pdf.id 
                      ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50' 
                      : 'hover:bg-gray-50 dark:hover:bg-[#2a2a2a] border border-transparent'
                  }`}
                >
                  <div className="flex items-center space-x-3 overflow-hidden">
                    <FileText size={18} className={activePdfId === pdf.id ? "text-blue-600" : "text-gray-400"} />
                    <span className="text-sm font-medium truncate w-32" title={pdf.name}>
                      {pdf.name}
                    </span>
                  </div>
                  <button 
                    onClick={(e) => removePdf(pdf.id, e)}
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </aside>

          {/* CENTER: Canvas PDF Viewer */}
          <main className="flex-1 bg-[#ebebeb] dark:bg-[#0f0f0f] flex flex-col overflow-hidden relative">
            {activePdf ? (
              <>
                {/* Custom PDF Controls bar */}
                <div className={`h-12 bg-white dark:bg-[#1a1a1a] border-b ${borderClass} px-4 flex items-center justify-between shrink-0`}>
                  <div className="flex items-center space-x-2">
                    <button 
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      disabled={currentPage <= 1}
                      className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-[#2b2b2b] disabled:opacity-40 transition-colors"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <span className="text-sm font-medium">
                      Page {currentPage} of {totalPages || '...'}
                    </span>
                    <button 
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                      disabled={currentPage >= totalPages}
                      className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-[#2b2b2b] disabled:opacity-40 transition-colors"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>

                  <div className="text-xs text-gray-500 font-mono truncate max-w-xs" title={activePdf.name}>
                    {activePdf.name}
                  </div>

                  <div className="flex items-center space-x-2">
                    <button 
                      onClick={() => setZoomScale(prev => Math.max(prev - 0.2, 0.6))}
                      className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-[#2b2b2b] transition-colors"
                      title="Zoom Out"
                    >
                      <ZoomOut size={16} />
                    </button>
                    <span className="text-xs font-mono w-10 text-center">{Math.round(zoomScale * 100)}%</span>
                    <button 
                      onClick={() => setZoomScale(prev => Math.min(prev + 0.2, 2.5))}
                      className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-[#2b2b2b] transition-colors"
                      title="Zoom In"
                    >
                      <ZoomIn size={16} />
                    </button>
                  </div>
                </div>

                {/* Main Render Area */}
                <div className="flex-1 overflow-auto p-6 flex justify-center items-start">
                  <div className="relative shadow-lg rounded-md border border-gray-300 dark:border-gray-800 bg-white">
                    {renderingPage && (
                      <div className="absolute inset-0 bg-white/70 dark:bg-[#1e1e1e]/70 flex items-center justify-center backdrop-blur-sm z-10 rounded-md">
                        <Loader2 className="animate-spin text-blue-600" size={32} />
                      </div>
                    )}
                    {/* Applying custom css filter in dark mode for elegant PDF colors inversion */}
                    <canvas 
                      ref={canvasRef} 
                      className={`block rounded-md transition-all duration-200 ${
                        isDarkMode ? 'invert hue-rotate-180 brightness-[0.95] contrast-[1.05]' : ''
                      }`}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                <BookOpen size={64} className="mb-4 opacity-20" />
                <p className="text-lg font-medium">Select or upload a document</p>
                <p className="text-sm mt-1 opacity-70">to start analyzing with Gemini</p>
              </div>
            )}
          </main>

          {/* RIGHT SIDEBAR: Gemini Chatbot */}
          <aside className={`w-80 border-l ${borderClass} bg-white dark:bg-[#1e1e1e] flex flex-col`}>
            {/* Chat Header */}
            <div className={`p-4 border-b ${borderClass} flex items-center space-x-2 shrink-0`}>
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
              <h2 className="font-medium">Document Assistant</h2>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
              {chatMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 px-4">
                  <p>Ask anything about the active document.</p>
                  <p className="text-xs mt-2 opacity-70">
                    Answers will include page references.
                  </p>
                </div>
              ) : (
                chatMessages.map((msg, i) => (
                  <div 
                    key={i} 
                    className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div className={`px-4 py-2.5 rounded-2xl max-w-[90%] leading-relaxed whitespace-pre-line ${
                      msg.role === 'user' 
                        ? 'bg-blue-600 text-white rounded-tr-sm' 
                        : 'bg-gray-100 dark:bg-[#2a2a2a] text-gray-800 dark:text-gray-200 rounded-tl-sm border border-gray-200 dark:border-gray-700/50'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))
              )}
              {isChatLoading && (
                <div className="flex items-center space-x-2 text-gray-400 px-2 animate-pulse">
                  <Loader2 size={14} className="animate-spin text-blue-500" />
                  <span className="text-xs">Gemini is analyzing...</span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat Input */}
            <div className={`p-4 border-t ${borderClass} bg-gray-50 dark:bg-[#1e1e1e] shrink-0`}>
              {!isKeyConnected ? (
                <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-900/50 text-center">
                  Please connect your Gemini API Key in the top bar to start chatting.
                </div>
              ) : !activePdfId ? (
                <div className="text-xs text-gray-500 text-center">
                  Open a document to chat.
                </div>
              ) : (
                <form onSubmit={handleSendMessage} className="relative">
                  <input
                    type="text"
                    value={currentInput}
                    onChange={(e) => setCurrentInput(e.target.value)}
                    placeholder="Ask about this document..."
                    disabled={isChatLoading}
                    className="w-full bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-700 rounded-xl pl-4 pr-10 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all dark:text-white"
                  />
                  <button 
                    type="submit"
                    disabled={!currentInput.trim() || isChatLoading}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Send size={16} />
                  </button>
                </form>
              )}
            </div>
          </aside>

        </div>
      </div>
    </div>
  );
}