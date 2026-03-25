import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Camera, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";
import api from "../services/api";

export default function ScanQR({ user, onLogout }) {
  const navigate = useNavigate();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const scannerRef = useRef(null);
  const containerRef = useRef(null);

  const startScanner = async () => {
    setError("");
    setResult(null);
    try {
      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (decodedText) => {
          // Stop scanner on success
          try { await scanner.stop(); } catch {}
          setScanning(false);
          handleQrResult(decodedText);
        },
        () => {} // ignore errors during scanning
      );
      setScanning(true);
    } catch (err) {
      setError("Camera access denied or not available. You can also enter the token manually.");
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch {}
      scannerRef.current = null;
    }
    setScanning(false);
  };

  useEffect(() => {
    return () => { stopScanner(); };
  }, []);

  const handleQrResult = async (qrData) => {
    setProcessing(true);
    setError("");
    try {
      // Extract token from URL: ...?token=XXXX
      let token = qrData;
      try {
        const url = new URL(qrData);
        token = url.searchParams.get("token") || qrData;
      } catch {
        // Not a URL, use as-is
      }

      const { data } = await api.post("/attendance/verify", { token });
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.error || "Verification failed");
    } finally {
      setProcessing(false);
    }
  };

  // Manual token input for demo (when camera not available)
  const [manualToken, setManualToken] = useState("");
  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (manualToken.trim()) handleQrResult(manualToken.trim());
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => { stopScanner(); navigate("/"); }} className="text-gray-500 hover:text-gray-700">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-800">Scan QR Code</h1>
            <p className="text-sm text-gray-500">{user.name}</p>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Result */}
        {result && (
          <div className={`rounded-2xl p-6 mb-6 text-center ${result.alreadyMarked ? "bg-yellow-50 border border-yellow-200" : "bg-green-50 border border-green-200"}`}>
            {result.alreadyMarked ? (
              <AlertCircle size={48} className="mx-auto text-yellow-500 mb-3" />
            ) : (
              <CheckCircle size={48} className="mx-auto text-green-500 mb-3" />
            )}
            <h3 className="text-xl font-bold text-gray-800">{result.message}</h3>
            {result.className && (
              <p className="text-gray-600 mt-2">{result.className} - {result.courseName}</p>
            )}
            {result.scannedAt && (
              <p className="text-sm text-gray-400 mt-1">
                {new Date(result.scannedAt).toLocaleTimeString("en-IN")}
              </p>
            )}
            <button
              onClick={() => { setResult(null); setError(""); }}
              className="mt-4 bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700 transition"
            >
              Scan Another
            </button>
          </div>
        )}

        {/* Error */}
        {error && !result && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 mb-6 text-center">
            <XCircle size={48} className="mx-auto text-red-500 mb-3" />
            <h3 className="text-lg font-bold text-red-700">{error}</h3>
            <button
              onClick={() => { setError(""); startScanner(); }}
              className="mt-4 bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700 transition"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Processing */}
        {processing && (
          <div className="bg-white rounded-2xl p-8 mb-6 text-center border">
            <div className="animate-spin w-12 h-12 border-4 border-purple-200 border-t-purple-600 rounded-full mx-auto mb-4"></div>
            <p className="text-gray-600">Verifying attendance...</p>
          </div>
        )}

        {/* Scanner */}
        {!result && !processing && (
          <>
            <div className="bg-white rounded-2xl shadow-sm border overflow-hidden mb-6">
              <div id="qr-reader" className="w-full" style={{ minHeight: scanning ? 300 : 0 }}></div>
              {!scanning && (
                <div className="p-8 text-center">
                  <Camera size={48} className="mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500 mb-4">Point your camera at the classroom QR code</p>
                  <button
                    onClick={startScanner}
                    className="bg-purple-600 text-white px-8 py-3 rounded-xl font-medium hover:bg-purple-700 transition"
                  >
                    Start Camera
                  </button>
                </div>
              )}
              {scanning && (
                <div className="p-4 text-center">
                  <p className="text-sm text-gray-500 mb-2">Scanning... Point at QR code</p>
                  <button onClick={stopScanner} className="text-sm text-red-500 hover:text-red-700">
                    Stop Camera
                  </button>
                </div>
              )}
            </div>

            {/* Manual token input for demo */}
            <div className="bg-white rounded-2xl shadow-sm border p-6">
              <h4 className="text-sm font-medium text-gray-600 mb-3">Or paste QR token/URL manually (for demo):</h4>
              <form onSubmit={handleManualSubmit} className="flex gap-2">
                <input
                  type="text"
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  placeholder="Paste token or URL here..."
                  className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                />
                <button type="submit" className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-purple-700 transition">
                  Verify
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
