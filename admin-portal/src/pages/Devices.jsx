import { useState, useEffect } from "react";
import { Tv, Wifi, WifiOff, CircleDot, Trash2, Play, Square, RefreshCw } from "lucide-react";
import api from "../services/api";

export default function Devices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchDevices = () => {
    api
      .get("/classroom-recording/devices")
      .then((r) => { setDevices(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchDevices();
    const interval = setInterval(fetchDevices, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleForceStart = async (deviceId) => {
    await api.post(`/classroom-recording/devices/${deviceId}/force-start`);
    fetchDevices();
  };

  const handleForceStop = async (deviceId) => {
    await api.post(`/classroom-recording/devices/${deviceId}/force-stop`);
    fetchDevices();
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this device?")) return;
    await api.delete(`/classroom-recording/devices/${id}`);
    fetchDevices();
  };

  const isOnline = (device) => {
    if (!device.lastHeartbeat) return false;
    return Date.now() - new Date(device.lastHeartbeat).getTime() < 5 * 60 * 1000;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Recording Devices</h2>
        <button
          onClick={fetchDevices}
          className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800"
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border p-5 flex items-center gap-4">
          <div className="bg-blue-100 p-3 rounded-lg">
            <Tv size={24} className="text-blue-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Total Devices</p>
            <p className="text-2xl font-bold text-gray-800">{devices.length}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-5 flex items-center gap-4">
          <div className="bg-green-100 p-3 rounded-lg">
            <Wifi size={24} className="text-green-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Online</p>
            <p className="text-2xl font-bold text-gray-800">
              {devices.filter(isOnline).length}
            </p>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-5 flex items-center gap-4">
          <div className="bg-red-100 p-3 rounded-lg">
            <CircleDot size={24} className="text-red-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Recording</p>
            <p className="text-2xl font-bold text-gray-800">
              {devices.filter((d) => d.isRecording).length}
            </p>
          </div>
        </div>
      </div>

      {/* APK Install Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
        <h4 className="font-medium text-blue-800 mb-1">Setup New Device</h4>
        <p className="text-sm text-blue-600">
          Install <strong>EduCampus-Recorder-v9.apk</strong> on Smart TV / Android tablet.
          In setup wizard, enter API URL: <code className="bg-blue-100 px-1.5 py-0.5 rounded text-xs">http://&lt;your-laptop-ip&gt;:4000/api</code>
        </p>
      </div>

      {/* Devices List */}
      <div className="bg-white rounded-xl shadow-sm border">
        <div className="p-6 border-b">
          <h3 className="text-lg font-semibold">Registered Devices</h3>
        </div>
        {loading ? (
          <div className="p-12 text-center text-gray-400">Loading...</div>
        ) : devices.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <Tv size={48} className="mx-auto mb-3 opacity-50" />
            <p>No devices registered yet.</p>
            <p className="text-sm mt-1">Install the APK on a Smart TV and complete setup.</p>
          </div>
        ) : (
          <div className="divide-y">
            {devices.map((device) => (
              <div key={device._id} className="p-5 px-6 flex items-center justify-between hover:bg-gray-50">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-lg ${isOnline(device) ? "bg-green-100" : "bg-gray-100"}`}>
                    <Tv size={24} className={isOnline(device) ? "text-green-600" : "text-gray-400"} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-800">{device.name}</p>
                      {isOnline(device) ? (
                        <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                          <Wifi size={10} /> Online
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">
                          <WifiOff size={10} /> Offline
                        </span>
                      )}
                      {device.isRecording && (
                        <span className="flex items-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full animate-pulse">
                          <CircleDot size={10} /> Recording
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Room: {device.roomNumber || device.roomId} | {device.deviceModel || device.deviceType} | IP: {device.ipAddress || "-"}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Device ID: {device.deviceId}
                      {device.lastHeartbeat && (
                        <> | Last heartbeat: {new Date(device.lastHeartbeat).toLocaleTimeString("en-IN")}</>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {device.isRecording ? (
                    <button
                      onClick={() => handleForceStop(device.deviceId)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 transition"
                      title="Force Stop"
                    >
                      <Square size={14} /> Stop
                    </button>
                  ) : (
                    <button
                      onClick={() => handleForceStart(device.deviceId)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-50 text-green-600 hover:bg-green-100 transition"
                      title="Force Start"
                    >
                      <Play size={14} /> Start
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(device._id)}
                    className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
