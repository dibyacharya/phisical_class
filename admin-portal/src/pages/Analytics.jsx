import { useState, useEffect, useCallback } from "react";
import api from "../services/api";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Cell, PieChart, Pie,
} from "recharts";
import {
  Activity, AlertTriangle, Cpu, HardDrive, Wifi, Thermometer,
  Monitor, ArrowLeft, RefreshCw, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Clock, Upload, MemoryStick,
} from "lucide-react";

const COLORS = {
  green: "#22c55e", yellow: "#eab308", red: "#ef4444",
  blue: "#3b82f6", purple: "#8b5cf6", orange: "#f97316",
  cyan: "#06b6d4", pink: "#ec4899", slate: "#64748b",
};

const AUTO_REFRESH_MS = 60000; // 1 min

export default function Analytics() {
  const [view, setView] = useState("fleet"); // fleet | device
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);

  // Data
  const [overview, setOverview] = useState(null);
  const [trends, setTrends] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [dailySummary, setDailySummary] = useState([]);
  const [peakHours, setPeakHours] = useState([]);
  const [deviceRanking, setDeviceRanking] = useState([]);
  const [deviceHistory, setDeviceHistory] = useState([]);

  // ── Fetch fleet data ─────────────────────────────────────────────
  const fetchFleetData = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    else setRefreshing(true);
    try {
      const [ovRes, trRes, alRes, dsRes, phRes, drRes] = await Promise.all([
        api.get("/analytics/fleet-overview"),
        api.get(`/analytics/trends?days=${days}`),
        api.get("/analytics/alerts"),
        api.get(`/analytics/daily-summary?days=${days}`),
        api.get(`/analytics/peak-hours?days=${days}`),
        api.get(`/analytics/device-ranking?days=${days}`),
      ]);
      setOverview(ovRes.data);
      setTrends(ovRes.data?.trends || trRes.data?.trends || []);
      setAlerts(alRes.data?.alerts || []);
      setDailySummary(dsRes.data?.dailyData || []);
      setPeakHours(phRes.data?.hours || []);
      setDeviceRanking(drRes.data?.devices || []);
      setTrends(trRes.data?.trends || []);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Analytics fetch error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [days]);

  // ── Fetch device-specific data ───────────────────────────────────
  const fetchDeviceData = useCallback(async (deviceId) => {
    setLoading(true);
    try {
      const res = await api.get(`/analytics/device/${deviceId}/history?days=${days}`);
      setDeviceHistory(res.data?.history || []);
      setSelectedDevice(res.data);
    } catch (err) {
      console.error("Device history fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    if (view === "fleet") fetchFleetData();
  }, [view, days, fetchFleetData]);

  // Auto-refresh
  useEffect(() => {
    if (view !== "fleet") return;
    const interval = setInterval(() => fetchFleetData(false), AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [view, fetchFleetData]);

  const openDevice = (deviceId) => {
    setView("device");
    fetchDeviceData(deviceId);
  };

  const backToFleet = () => {
    setView("fleet");
    setSelectedDevice(null);
    setDeviceHistory([]);
  };

  // ════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════

  if (loading && !overview) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-blue-500" size={32} />
        <span className="ml-3 text-slate-500">Loading analytics...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {view === "device" && (
            <button onClick={backToFleet} className="p-2 hover:bg-slate-100 rounded-lg">
              <ArrowLeft size={20} />
            </button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-slate-800">
              {view === "fleet" ? "Fleet Health Analytics" : `Device: ${selectedDevice?.deviceName || selectedDevice?.deviceId}`}
            </h1>
            <p className="text-slate-500 text-sm">
              {view === "fleet"
                ? `${overview?.total || 0} devices monitored`
                : `Room: ${selectedDevice?.roomNumber || "—"}`}
              {lastRefresh && ` · Updated ${lastRefresh.toLocaleTimeString()}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            className="px-3 py-2 border rounded-lg text-sm"
          >
            <option value={1}>Last 24h</option>
            <option value={3}>Last 3 days</option>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <button
            onClick={() => view === "fleet" ? fetchFleetData(false) : fetchDeviceData(selectedDevice?.deviceId)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            disabled={refreshing}
          >
            <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {view === "fleet" ? <FleetView /> : <DeviceView />}
    </div>
  );

  // ════════════════════════════════════════════════════════════════
  // FLEET VIEW
  // ════════════════════════════════════════════════════════════════
  function FleetView() {
    return (
      <div className="space-y-6">
        {/* Overview Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <StatCard label="Total" value={overview?.total} icon={Monitor} color="slate" />
          <StatCard label="Online" value={overview?.online} icon={CheckCircle2} color="green" />
          <StatCard label="Offline" value={overview?.offline} icon={XCircle} color="red" />
          <StatCard label="Recording" value={overview?.recording} icon={Activity} color="blue" />
          <StatCard label="Healthy" value={overview?.healthy} icon={CheckCircle2} color="green" />
          <StatCard label="Warning" value={overview?.warning} icon={AlertTriangle} color="yellow" />
          <StatCard label="Critical" value={overview?.critical} icon={XCircle} color="red" />
        </div>

        {/* Alerts */}
        {alerts.length > 0 && <AlertsPanel alerts={alerts} onDeviceClick={openDevice} />}

        {/* Trend Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartCard title="CPU Usage (%)" icon={Cpu}>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Area type="monotone" dataKey="avgCpuUsage" name="Avg CPU" stroke={COLORS.blue} fill={COLORS.blue} fillOpacity={0.15} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="RAM Usage (%)" icon={MemoryStick}>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Area type="monotone" dataKey="avgRamUsage" name="Avg RAM" stroke={COLORS.purple} fill={COLORS.purple} fillOpacity={0.15} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="WiFi Signal (dBm)" icon={Wifi}>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis domain={[-100, -20]} tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Line type="monotone" dataKey="avgWifiSignal" name="Avg Signal" stroke={COLORS.cyan} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="CPU Temperature (\u00b0C)" icon={Thermometer}>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis domain={[20, 90]} tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Area type="monotone" dataKey="avgCpuTemp" name="Avg Temp" stroke={COLORS.orange} fill={COLORS.orange} fillOpacity={0.15} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Frame Drops / Hour" icon={AlertTriangle}>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Bar dataKey="totalFrameDrops" name="Frame Drops" fill={COLORS.red} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Network Latency (ms)" icon={Wifi}>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Line type="monotone" dataKey="avgLatency" name="Avg Latency" stroke={COLORS.pink} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Daily Summary Table */}
        {dailySummary.length > 0 && <DailySummaryTable data={dailySummary} />}

        {/* Peak Hours */}
        {peakHours.length > 0 && (
          <ChartCard title="Peak Hours Analysis (IST)" icon={Clock}>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={peakHours.map(h => ({ ...h, hourLabel: `${((h.hour + 5) % 24).toString().padStart(2, "0")}:30` }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hourLabel" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="avgCpuUsage" name="CPU %" fill={COLORS.blue} radius={[4, 4, 0, 0]} />
                <Bar dataKey="totalFrameDrops" name="Frame Drops" fill={COLORS.red} radius={[4, 4, 0, 0]} />
                <Bar dataKey="recordingSnapshots" name="Recording Samples" fill={COLORS.green} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}

        {/* Device Ranking Table */}
        <DeviceRankingTable devices={deviceRanking} onDeviceClick={openDevice} />
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // DEVICE VIEW
  // ════════════════════════════════════════════════════════════════
  function DeviceView() {
    if (!selectedDevice || deviceHistory.length === 0) {
      return (
        <div className="text-center py-16 text-slate-500">
          {loading ? (
            <RefreshCw className="animate-spin mx-auto mb-3" size={32} />
          ) : (
            <>
              <Monitor className="mx-auto mb-3 text-slate-300" size={48} />
              <p>No health data available for this device in the last {days} days.</p>
              <p className="text-sm mt-1">Data collection starts once the device sends its first heartbeat.</p>
            </>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {/* Device Info */}
        <div className="bg-white rounded-xl border p-6 flex flex-wrap gap-6">
          <InfoChip label="Device" value={selectedDevice.deviceName} />
          <InfoChip label="Room" value={selectedDevice.roomNumber} />
          <InfoChip label="Data Points" value={selectedDevice.dataPoints} />
          <InfoChip label="Period" value={`${days} days`} />
        </div>

        {/* Device Trend Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartCard title="CPU Usage & Max (%)" icon={Cpu}>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={deviceHistory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Legend />
                <Area type="monotone" dataKey="avgCpuUsage" name="Avg" stroke={COLORS.blue} fill={COLORS.blue} fillOpacity={0.1} />
                <Area type="monotone" dataKey="maxCpuUsage" name="Max" stroke={COLORS.red} fill={COLORS.red} fillOpacity={0.05} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="RAM Usage & Max (%)" icon={MemoryStick}>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={deviceHistory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Legend />
                <Area type="monotone" dataKey="avgRamUsage" name="Avg" stroke={COLORS.purple} fill={COLORS.purple} fillOpacity={0.1} />
                <Area type="monotone" dataKey="maxRamUsage" name="Max" stroke={COLORS.red} fill={COLORS.red} fillOpacity={0.05} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="WiFi Signal (dBm)" icon={Wifi}>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={deviceHistory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis domain={[-100, -20]} tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Legend />
                <Line type="monotone" dataKey="avgWifiSignal" name="Avg" stroke={COLORS.cyan} dot={false} />
                <Area type="monotone" dataKey="minWifiSignal" name="Min (Worst)" stroke={COLORS.red} fill={COLORS.red} fillOpacity={0.05} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Temperature & Latency" icon={Thermometer}>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={deviceHistory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis yAxisId="temp" domain={[20, 90]} tick={{ fontSize: 11 }} />
                <YAxis yAxisId="latency" orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Legend />
                <Line yAxisId="temp" type="monotone" dataKey="avgCpuTemp" name="Temp (\u00b0C)" stroke={COLORS.orange} dot={false} />
                <Line yAxisId="temp" type="monotone" dataKey="maxCpuTemp" name="Max Temp" stroke={COLORS.red} dot={false} strokeDasharray="5 5" />
                <Line yAxisId="latency" type="monotone" dataKey="avgLatency" name="Latency (ms)" stroke={COLORS.pink} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Frame Drops & Errors" icon={AlertTriangle}>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={deviceHistory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Legend />
                <Bar dataKey="totalFrameDrops" name="Frame Drops" fill={COLORS.yellow} radius={[4, 4, 0, 0]} />
                <Bar dataKey="totalErrors" name="Errors" fill={COLORS.red} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Uploads" icon={Upload}>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={deviceHistory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Legend />
                <Bar dataKey="uploadSuccess" name="Success" fill={COLORS.green} stackId="upload" radius={[4, 4, 0, 0]} />
                <Bar dataKey="uploadFail" name="Failed" fill={COLORS.red} stackId="upload" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Disk Usage Trend */}
        <ChartCard title="Disk Usage (%)" icon={HardDrive}>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={deviceHistory}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip labelFormatter={formatTooltipTime} />
              <Area type="monotone" dataKey="avgDiskUsage" name="Disk %" stroke={COLORS.slate} fill={COLORS.slate} fillOpacity={0.15} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    );
  }
}

// ════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ════════════════════════════════════════════════════════════════════

function StatCard({ label, value, icon: Icon, color }) {
  const colorMap = {
    green: "bg-green-50 text-green-700 border-green-200",
    red: "bg-red-50 text-red-700 border-red-200",
    yellow: "bg-yellow-50 text-yellow-700 border-yellow-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    slate: "bg-slate-50 text-slate-700 border-slate-200",
  };
  return (
    <div className={`rounded-xl border p-4 ${colorMap[color] || colorMap.slate}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={16} />
        <span className="text-xs font-medium uppercase">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value ?? "—"}</div>
    </div>
  );
}

function ChartCard({ title, icon: Icon, children }) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <div className="flex items-center gap-2 mb-4">
        {Icon && <Icon size={18} className="text-slate-500" />}
        <h3 className="font-semibold text-slate-700">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function InfoChip({ label, value }) {
  return (
    <div>
      <span className="text-xs text-slate-500 uppercase">{label}</span>
      <p className="font-semibold text-slate-800">{value || "—"}</p>
    </div>
  );
}

function AlertsPanel({ alerts, onDeviceClick }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? alerts : alerts.slice(0, 5);

  return (
    <div className="bg-white rounded-xl border">
      <div className="px-5 py-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-red-500" />
          <h3 className="font-semibold text-slate-700">Active Alerts ({alerts.length})</h3>
        </div>
        {alerts.length > 5 && (
          <button onClick={() => setExpanded(!expanded)} className="text-sm text-blue-600 flex items-center gap-1">
            {expanded ? <><ChevronUp size={14} /> Less</> : <><ChevronDown size={14} /> Show all</>}
          </button>
        )}
      </div>
      <div className="divide-y">
        {shown.map((a, i) => (
          <div key={i} className="px-5 py-3 flex items-center gap-4 hover:bg-slate-50">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${a.severity === "critical" ? "bg-red-500" : "bg-yellow-500"}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-700 truncate">{a.message}</p>
              <p className="text-xs text-slate-400">{a.deviceName} · {a.roomNumber || "—"} · {a.type}</p>
            </div>
            <button
              onClick={() => onDeviceClick(a.deviceId)}
              className="text-xs text-blue-600 hover:underline flex-shrink-0"
            >
              View
            </button>
          </div>
        ))}
        {alerts.length === 0 && (
          <div className="px-5 py-8 text-center text-slate-400">
            <CheckCircle2 className="mx-auto mb-2" size={32} />
            All devices healthy
          </div>
        )}
      </div>
    </div>
  );
}

function DailySummaryTable({ data }) {
  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="px-5 py-4 border-b">
        <h3 className="font-semibold text-slate-700">Daily Summary</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Date</th>
              <th className="px-4 py-3 text-right font-medium">Devices</th>
              <th className="px-4 py-3 text-right font-medium">Rec Hours</th>
              <th className="px-4 py-3 text-right font-medium">Avg CPU</th>
              <th className="px-4 py-3 text-right font-medium">Max CPU</th>
              <th className="px-4 py-3 text-right font-medium">Avg RAM</th>
              <th className="px-4 py-3 text-right font-medium">Avg Temp</th>
              <th className="px-4 py-3 text-right font-medium">WiFi (dBm)</th>
              <th className="px-4 py-3 text-right font-medium">Frame Drops</th>
              <th className="px-4 py-3 text-right font-medium">Errors</th>
              <th className="px-4 py-3 text-right font-medium">Uploads</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.map((d, i) => (
              <tr key={i} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{new Date(d.date).toLocaleDateString("en-IN", { weekday: "short", month: "short", day: "numeric" })}</td>
                <td className="px-4 py-3 text-right">{d.deviceCount}</td>
                <td className="px-4 py-3 text-right">{d.estimatedRecordingHours}h</td>
                <td className="px-4 py-3 text-right">{cpuBadge(d.avgCpuUsage)}</td>
                <td className="px-4 py-3 text-right">{cpuBadge(d.maxCpuUsage)}</td>
                <td className="px-4 py-3 text-right">{ramBadge(d.avgRamUsage)}</td>
                <td className="px-4 py-3 text-right">{tempBadge(d.avgCpuTemp)}</td>
                <td className="px-4 py-3 text-right">{wifiBadge(d.avgWifiSignal)}</td>
                <td className="px-4 py-3 text-right">{errorBadge(d.totalFrameDrops)}</td>
                <td className="px-4 py-3 text-right">{errorBadge(d.totalErrors)}</td>
                <td className="px-4 py-3 text-right text-slate-600">{(d.uploadSuccess || 0) + (d.uploadFail || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeviceRankingTable({ devices, onDeviceClick }) {
  const [sortKey, setSortKey] = useState("totalErrors");
  const [sortDir, setSortDir] = useState("desc");

  const sorted = [...devices].sort((a, b) => {
    const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0;
    return sortDir === "desc" ? bv - av : av - bv;
  });

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const SortHeader = ({ label, k }) => (
    <th
      className="px-4 py-3 text-right font-medium cursor-pointer hover:text-blue-600"
      onClick={() => toggleSort(k)}
    >
      {label} {sortKey === k && (sortDir === "desc" ? "\u2193" : "\u2191")}
    </th>
  );

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="px-5 py-4 border-b">
        <h3 className="font-semibold text-slate-700">Device Performance Ranking</h3>
        <p className="text-xs text-slate-400 mt-1">Click column headers to sort. Click device name to drill down.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Device</th>
              <th className="px-4 py-3 text-left font-medium">Room</th>
              <SortHeader label="Avg CPU" k="avgCpuUsage" />
              <SortHeader label="Avg RAM" k="avgRamUsage" />
              <SortHeader label="Avg Temp" k="avgCpuTemp" />
              <SortHeader label="WiFi" k="avgWifiSignal" />
              <SortHeader label="Latency" k="avgLatency" />
              <SortHeader label="Drops" k="totalFrameDrops" />
              <SortHeader label="Errors" k="totalErrors" />
              <SortHeader label="Rec Hrs" k="estimatedRecordingHours" />
              <SortHeader label="Upload %" k="uploadSuccessRate" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {sorted.map((d, i) => (
              <tr key={i} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <button onClick={() => onDeviceClick(d.deviceId)} className="text-blue-600 hover:underline font-medium">
                    {d.deviceName || d.deviceId?.slice(0, 12)}
                  </button>
                </td>
                <td className="px-4 py-3 text-slate-600">{d.roomNumber || "—"}</td>
                <td className="px-4 py-3 text-right">{cpuBadge(d.avgCpuUsage)}</td>
                <td className="px-4 py-3 text-right">{ramBadge(d.avgRamUsage)}</td>
                <td className="px-4 py-3 text-right">{tempBadge(d.avgCpuTemp)}</td>
                <td className="px-4 py-3 text-right">{wifiBadge(d.avgWifiSignal)}</td>
                <td className="px-4 py-3 text-right">{d.avgLatency != null ? `${d.avgLatency}ms` : "—"}</td>
                <td className="px-4 py-3 text-right">{errorBadge(d.totalFrameDrops)}</td>
                <td className="px-4 py-3 text-right">{errorBadge(d.totalErrors)}</td>
                <td className="px-4 py-3 text-right text-slate-600">{d.estimatedRecordingHours ?? "—"}h</td>
                <td className="px-4 py-3 text-right">{uploadBadge(d.uploadSuccessRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:00`;
}

function formatTooltipTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-IN", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function badge(text, color) {
  const map = {
    green: "bg-green-100 text-green-700",
    yellow: "bg-yellow-100 text-yellow-700",
    red: "bg-red-100 text-red-700",
    slate: "bg-slate-100 text-slate-600",
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[color] || map.slate}`}>{text}</span>;
}

function cpuBadge(v) {
  if (v == null) return "—";
  const color = v > 80 ? "red" : v > 60 ? "yellow" : "green";
  return badge(`${v}%`, color);
}

function ramBadge(v) {
  if (v == null) return "—";
  const color = v > 90 ? "red" : v > 75 ? "yellow" : "green";
  return badge(`${v}%`, color);
}

function tempBadge(v) {
  if (v == null) return "—";
  const color = v > 75 ? "red" : v > 60 ? "yellow" : "green";
  return badge(`${v}\u00b0C`, color);
}

function wifiBadge(v) {
  if (v == null) return "—";
  const color = v < -85 ? "red" : v < -70 ? "yellow" : "green";
  return badge(`${v}`, color);
}

function errorBadge(v) {
  if (v == null || v === 0) return badge("0", "green");
  const color = v > 20 ? "red" : v > 5 ? "yellow" : "slate";
  return badge(v, color);
}

function uploadBadge(v) {
  if (v == null) return "—";
  const color = v < 80 ? "red" : v < 95 ? "yellow" : "green";
  return badge(`${v}%`, color);
}
