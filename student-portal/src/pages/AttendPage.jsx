import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CheckCircle, XCircle, AlertCircle } from "lucide-react";
import api from "../services/api";

export default function AttendPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setError("No attendance token found in URL");
      setLoading(false);
      return;
    }

    api
      .post("/attendance/verify", { token })
      .then(({ data }) => setResult(data))
      .catch((err) => setError(err.response?.data?.error || "Verification failed"))
      .finally(() => setLoading(false));
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8 text-center">
        {loading && (
          <>
            <div className="animate-spin w-12 h-12 border-4 border-purple-200 border-t-purple-600 rounded-full mx-auto mb-4"></div>
            <p className="text-gray-600">Marking attendance...</p>
          </>
        )}

        {result && (
          <>
            {result.alreadyMarked ? (
              <AlertCircle size={56} className="mx-auto text-yellow-500 mb-4" />
            ) : (
              <CheckCircle size={56} className="mx-auto text-green-500 mb-4" />
            )}
            <h2 className="text-xl font-bold text-gray-800 mb-2">{result.message}</h2>
            {result.className && (
              <p className="text-gray-600">{result.className}</p>
            )}
            {result.courseName && (
              <p className="text-sm text-gray-500">{result.courseName}</p>
            )}
            {result.scannedAt && (
              <p className="text-xs text-gray-400 mt-2">
                {new Date(result.scannedAt).toLocaleString("en-IN")}
              </p>
            )}
          </>
        )}

        {error && (
          <>
            <XCircle size={56} className="mx-auto text-red-500 mb-4" />
            <h2 className="text-xl font-bold text-red-700 mb-2">Failed</h2>
            <p className="text-gray-600">{error}</p>
          </>
        )}

        <button
          onClick={() => navigate("/")}
          className="mt-6 bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700 transition"
        >
          Go Home
        </button>
      </div>
    </div>
  );
}
