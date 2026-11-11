import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Upload, Plus, Calendar, BookOpen, CheckCircle2, Circle, Trash2, X,
  GraduationCap, Clock, AlertCircle, FileUp, ChevronRight, Sparkles,
  LayoutGrid, ListChecks, Pencil
} from "lucide-react";

const COURSE_COLORS = [
  { bg: "bg-indigo-50", text: "text-indigo-700", dot: "bg-indigo-500", ring: "ring-indigo-200" },
  { bg: "bg-rose-50", text: "text-rose-700", dot: "bg-rose-500", ring: "ring-rose-200" },
  { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500", ring: "ring-amber-200" },
  { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", ring: "ring-emerald-200" },
  { bg: "bg-sky-50", text: "text-sky-700", dot: "bg-sky-500", ring: "ring-sky-200" },
  { bg: "bg-fuchsia-50", text: "text-fuchsia-700", dot: "bg-fuchsia-500", ring: "ring-fuchsia-200" },
  { bg: "bg-orange-50", text: "text-orange-700", dot: "bg-orange-500", ring: "ring-orange-200" },
  { bg: "bg-teal-50", text: "text-teal-700", dot: "bg-teal-500", ring: "ring-teal-200" },
];

function colorForCourse(courseId, courses) {
  const idx = courses.findIndex((c) => c.id === courseId);
  return COURSE_COLORS[idx >= 0 ? idx % COURSE_COLORS.length : 0];
}

// --- Minimal client-side .ics parser (no network calls, no tokens) ---
function unfoldIcs(raw) {
  return raw.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

function parseIcsDate(value) {
  if (!value) return null;
  const clean = value.trim();
  const m = clean.match(/^(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2})Z?)?$/);
  if (!m) return null;
  const [, y, mo, d, , h = "0", mi = "0", s = "0"] = m;
  if (clean.endsWith("Z")) {
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  }
  return new Date(+y, +mo - 1, +d, +h, +mi, +s);
}

function extractCourseTag(summary) {
  const m = summary.match(/\[([^\]]+)\]\s*$/);
  if (m) return { title: summary.replace(/\s*\[[^\]]+\]\s*$/, "").trim(), tag: m[1].trim() };
  return { title: summary.trim(), tag: "General" };
}

function parseIcs(raw) {
  const text = unfoldIcs(raw);
  const lines = text.split("\n");
  const events = [];
  let cur = null;
  for (let line of lines) {
    line = line.trim();
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    let key = line.slice(0, idx);
    const value = line.slice(idx + 1);
    key = key.split(";")[0];
    if (key === "SUMMARY") cur.summary = value.replace(/\\,/g, ",").replace(/\\n/gi, " ");
    if (key === "DTSTART") cur.dtstart = value;
    if (key === "UID") cur.uid = value;
    if (key === "DESCRIPTION") cur.description = value.replace(/\\,/g, ",").replace(/\\n/gi, " ");
  }
  return events
    .map((e) => {
      const date = parseIcsDate(e.dtstart);
      if (!date || !e.summary) return null;
      const { title, tag } = extractCourseTag(e.summary);
      return { uid: e.uid || `${title}-${e.dtstart}`, title, courseTag: tag, due: date.toISOString(), description: e.description || "" };
    })
    .filter(Boolean);
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function daysUntil(iso) {
  const now = new Date();
  const then = new Date(iso);
  return Math.ceil((then - now) / (1000 * 60 * 60 * 24));
}

const STORAGE_KEY = "studydesk-state";

export default function StudyDesk() {
  const [courses, setCourses] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState("dashboard");
  const [showAddAssignment, setShowAddAssignment] = useState(false);
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [importError, setImportError] = useState("");
  const [importSuccess, setImportSuccess] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const result = raw ? { value: raw } : null;
        if (result && result.value) {
          const parsed = JSON.parse(result.value);
          setCourses(parsed.courses || []);
          setAssignments(parsed.assignments || []);
        }
      } catch (e) {
        // no existing data
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ courses, assignments }));
      } catch (e) {
        console.error("Failed to save", e);
      }
    })();
  }, [courses, assignments, loaded]);

  function upsertCourseByTag(tag) {
    let course = courses.find((c) => c.tag === tag);
    if (course) return course;
    course = { id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, tag, name: tag, grades: [] };
    setCourses((prev) => [...prev, course]);
    return course;
  }

  function handleIcsFile(file) {
    setImportError("");
    setImportSuccess("");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = parseIcs(String(e.target.result));
        if (parsed.length === 0) {
          setImportError("No events found in that file. Make sure it's a Canvas calendar (.ics) export.");
          return;
        }
        const tagToCourse = {};
        const newCourses = [...courses];
        for (const ev of parsed) {
          if (!tagToCourse[ev.courseTag]) {
            let existing = newCourses.find((c) => c.tag === ev.courseTag);
            if (!existing) {
              existing = { id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, tag: ev.courseTag, name: ev.courseTag, grades: [] };
              newCourses.push(existing);
            }
            tagToCourse[ev.courseTag] = existing;
          }
        }
        setCourses(newCourses);
        setAssignments((prev) => {
          const existingUids = new Set(prev.map((a) => a.uid));
          const additions = parsed
            .filter((ev) => !existingUids.has(ev.uid))
            .map((ev) => ({
              id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              uid: ev.uid,
              title: ev.title,
              courseId: tagToCourse[ev.courseTag].id,
              due: ev.due,
              description: ev.description,
              completed: false,
              score: null,
              maxScore: null,
            }));
          return [...prev, ...additions];
        });
        setImportSuccess(`Imported ${parsed.length} item${parsed.length === 1 ? "" : "s"} from your calendar.`);
        setView("dashboard");
      } catch (err) {
        setImportError("Couldn't read that file. Make sure it's a valid .ics calendar export.");
      }
    };
    reader.readAsText(file);
  }

  function toggleComplete(id) {
    setAssignments((prev) => prev.map((a) => (a.id === id ? { ...a, completed: !a.completed } : a)));
  }

  function deleteAssignment(id) {
    setAssignments((prev) => prev.filter((a) => a.id !== id));
  }

  function deleteCourse(id) {
    setCourses((prev) => prev.filter((c) => c.id !== id));
    setAssignments((prev) => prev.filter((a) => a.courseId !== id));
  }

  const upcoming = useMemo(() => {
    return assignments
      .filter((a) => !a.completed)
      .sort((a, b) => new Date(a.due) - new Date(b.due));
  }, [assignments]);

  const overdue = upcoming.filter((a) => daysUntil(a.due) < 0);
  const thisWeek = upcoming.filter((a) => daysUntil(a.due) >= 0 && daysUntil(a.due) <= 7);
  const later = upcoming.filter((a) => daysUntil(a.due) > 7);

  const hasAnyData = courses.length > 0 || assignments.length > 0;

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-400 text-sm">Loading StudyDesk...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <GraduationCap className="w-4.5 h-4.5 text-white" size={18} />
            </div>
            <span className="font-semibold text-slate-900 text-lg">StudyDesk</span>
          </div>
          <nav className="flex items-center gap-1">
            <button
              onClick={() => setView("dashboard")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${view === "dashboard" ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50"}`}
            >
              <LayoutGrid size={15} /> Dashboard
            </button>
            <button
              onClick={() => setView("courses")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${view === "courses" ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50"}`}
            >
              <BookOpen size={15} /> Courses
            </button>
            <button
              onClick={() => setView("import")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${view === "import" ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50"}`}
            >
              <Upload size={15} /> Import
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {!hasAnyData && view !== "import" ? (
          <EmptyState onImport={() => setView("import")} onManual={() => setShowAddCourse(true)} />
        ) : view === "dashboard" ? (
          <Dashboard
            courses={courses}
            overdue={overdue}
            thisWeek={thisWeek}
            later={later}
            onToggle={toggleComplete}
            onDelete={deleteAssignment}
            onAdd={() => setShowAddAssignment(true)}
          />
        ) : view === "courses" ? (
          <Courses
            courses={courses}
            assignments={assignments}
            onDeleteCourse={deleteCourse}
            onAddCourse={() => setShowAddCourse(true)}
            onUpdateCourse={(id, patch) => setCourses((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))}
          />
        ) : (
          <ImportView
            fileInputRef={fileInputRef}
            onFile={handleIcsFile}
            error={importError}
            success={importSuccess}
            onManual={() => setShowAddCourse(true)}
          />
        )}
      </main>

      {showAddAssignment && (
        <AddAssignmentModal
          courses={courses}
          onClose={() => setShowAddAssignment(false)}
          onSave={(a) => {
            setAssignments((prev) => [...prev, { id: `a_${Date.now()}`, uid: `manual_${Date.now()}`, completed: false, score: null, maxScore: null, description: "", ...a }]);
            setShowAddAssignment(false);
          }}
        />
      )}

      {showAddCourse && (
        <AddCourseModal
          onClose={() => setShowAddCourse(false)}
          onSave={(c) => {
            setCourses((prev) => [...prev, { id: `c_${Date.now()}`, grades: [], ...c }]);
            setShowAddCourse(false);
          }}
        />
      )}
    </div>
  );
}

function EmptyState({ onImport, onManual }) {
  return (
    <div className="text-center py-20">
      <div className="w-16 h-16 rounded-2xl bg-indigo-100 flex items-center justify-center mx-auto mb-5">
        <Sparkles className="text-indigo-600" size={28} />
      </div>
      <h1 className="text-2xl font-semibold text-slate-900 mb-2">Set up your dashboard</h1>
      <p className="text-slate-500 max-w-md mx-auto mb-8">
        Bring in your schedule from Canvas's calendar export, or add your courses and assignments by hand. No access token needed either way.
      </p>
      <div className="flex items-center justify-center gap-3">
        <button onClick={onImport} className="px-5 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2">
          <Upload size={16} /> Import calendar file
        </button>
        <button onClick={onManual} className="px-5 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors flex items-center gap-2">
          <Plus size={16} /> Add a course manually
        </button>
      </div>
    </div>
  );
}

function ImportView({ fileInputRef, onFile, error, success, onManual }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Import your schedule</h1>
      <p className="text-slate-500 text-sm mb-6">
        Canvas can export your calendar as an .ics file without an access token. In Canvas, go to Calendar, click the gear icon, then "Export Calendar Feed" (or download the .ics link it gives you).
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${dragging ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-white hover:border-slate-300"}`}
      >
        <FileUp className="mx-auto mb-3 text-slate-400" size={28} />
        <p className="text-sm font-medium text-slate-700">Drop your .ics file here, or click to browse</p>
        <p className="text-xs text-slate-400 mt-1">Nothing is uploaded anywhere — parsing happens right in your browser.</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".ics,text/calendar"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = "";
          }}
        />
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2.5">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="mt-4 flex items-start gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2.5">
          <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}

      <div className="mt-8 pt-6 border-t border-slate-200">
        <p className="text-sm text-slate-500 mb-3">Prefer not to import a file? You can add everything by hand instead.</p>
        <button onClick={onManual} className="px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors flex items-center gap-2">
          <Plus size={16} /> Add a course manually
        </button>
      </div>
    </div>
  );
}

function Dashboard({ courses, overdue, thisWeek, later, onToggle, onDelete, onAdd }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Your dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">{overdue.length + thisWeek.length + later.length} upcoming item{overdue.length + thisWeek.length + later.length === 1 ? "" : "s"} across {courses.length} course{courses.length === 1 ? "" : "s"}</p>
        </div>
        <button onClick={onAdd} className="px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors flex items-center gap-1.5">
          <Plus size={15} /> Add assignment
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-8">
        <StatCard label="Overdue" value={overdue.length} tone="rose" />
        <StatCard label="Due this week" value={thisWeek.length} tone="amber" />
        <StatCard label="Courses" value={courses.length} tone="indigo" />
      </div>

      {overdue.length > 0 && (
        <Section title="Overdue" items={overdue} courses={courses} onToggle={onToggle} onDelete={onDelete} tone="rose" />
      )}
      <Section title="Due this week" items={thisWeek} courses={courses} onToggle={onToggle} onDelete={onDelete} tone="amber" empty="Nothing due in the next 7 days." />
      <Section title="Later" items={later} courses={courses} onToggle={onToggle} onDelete={onDelete} tone="slate" empty="Nothing further out on the calendar." />
    </div>
  );
}

function StatCard({ label, value, tone }) {
  const tones = { rose: "text-rose-600", amber: "text-amber-600", indigo: "text-indigo-600" };
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-3.5">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${tones[tone]}`}>{value}</p>
    </div>
  );
}

function Section({ title, items, courses, onToggle, onDelete, tone, empty }) {
  if (items.length === 0 && !empty) return null;
  return (
    <div className="mb-7">
      <h2 className="text-sm font-medium text-slate-700 mb-2.5 flex items-center gap-2">
        {title}
        <span className="text-xs text-slate-400 font-normal">{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400 bg-white border border-dashed border-slate-200 rounded-xl px-4 py-4">{empty}</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((a) => (
            <AssignmentRow key={a.id} a={a} courses={courses} onToggle={onToggle} onDelete={onDelete} tone={tone} />
          ))}
        </div>
      )}
    </div>
  );
}

function AssignmentRow({ a, courses, onToggle, onDelete, tone }) {
  const course = courses.find((c) => c.id === a.courseId);
  const color = colorForCourse(a.courseId, courses);
  const days = daysUntil(a.due);
  return (
    <div className="group bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3 hover:border-slate-300 transition-colors">
      <button onClick={() => onToggle(a.id)} className="flex-shrink-0 text-slate-300 hover:text-indigo-600 transition-colors">
        {a.completed ? <CheckCircle2 size={19} className="text-indigo-600" /> : <Circle size={19} />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium text-slate-800 truncate ${a.completed ? "line-through text-slate-400" : ""}`}>{a.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {course && (
            <span className={`text-xs px-1.5 py-0.5 rounded ${color.bg} ${color.text}`}>{course.name}</span>
          )}
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <Clock size={11} /> {fmtDate(a.due)} · {fmtTime(a.due)}
          </span>
        </div>
      </div>
      {tone === "rose" && !a.completed && (
        <span className="text-xs font-medium text-rose-600 flex-shrink-0">{Math.abs(days)}d late</span>
      )}
      <button onClick={() => onDelete(a.id)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-500 transition-all flex-shrink-0">
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function Courses({ courses, assignments, onDeleteCourse, onAddCourse, onUpdateCourse }) {
  const [editingGrade, setEditingGrade] = useState(null);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Courses</h1>
        <button onClick={onAddCourse} className="px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors flex items-center gap-1.5">
          <Plus size={15} /> Add course
        </button>
      </div>

      {courses.length === 0 ? (
        <p className="text-sm text-slate-400 bg-white border border-dashed border-slate-200 rounded-xl px-4 py-8 text-center">No courses yet. Import a calendar file or add one manually.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {courses.map((c) => {
            const color = colorForCourse(c.id, courses);
            const items = assignments.filter((a) => a.courseId === c.id);
            const openCount = items.filter((a) => !a.completed).length;
            const graded = items.filter((a) => typeof a.score === "number" && typeof a.maxScore === "number" && a.maxScore > 0);
            const avg = graded.length
              ? Math.round((graded.reduce((s, a) => s + a.score / a.maxScore, 0) / graded.length) * 100)
              : null;
            return (
              <div key={c.id} className="group bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${color.dot}`} />
                    <span className="font-medium text-slate-800 text-sm">{c.name}</span>
                  </div>
                  <button onClick={() => onDeleteCourse(c.id)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-500 transition-all">
                    <Trash2 size={14} />
                  </button>
                </div>
                <p className="text-xs text-slate-400 mb-3">{openCount} open item{openCount === 1 ? "" : "s"}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Average grade</span>
                  {avg !== null ? (
                    <span className={`text-sm font-semibold ${color.text}`}>{avg}%</span>
                  ) : (
                    <span className="text-xs text-slate-300">No grades entered</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AddCourseModal({ onClose, onSave }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal onClose={onClose} title="Add a course">
      <label className="text-xs font-medium text-slate-500 mb-1 block">Course name</label>
      <input
        autoFocus
        value={name}
        onChange={(e) => { setName(e.target.value); setError(""); }}
        placeholder="e.g. BISC 207, Intro to Psychology"
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-1 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
      />
      {error && <p className="text-xs text-rose-500 mb-2">{error}</p>}
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3.5 py-2 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-50">Cancel</button>
        <button
          onClick={() => {
            if (!name.trim()) { setError("Enter a course name first."); return; }
            onSave({ name: name.trim(), tag: name.trim() });
          }}
          className="px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
        >
          Add course
        </button>
      </div>
    </Modal>
  );
}

function AddAssignmentModal({ courses, onClose, onSave }) {
  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState(courses[0]?.id || "");
  const [due, setDue] = useState("");
  const [error, setError] = useState("");

  return (
    <Modal onClose={onClose} title="Add assignment">
      <label className="text-xs font-medium text-slate-500 mb-1 block">Title</label>
      <input
        autoFocus
        value={title}
        onChange={(e) => { setTitle(e.target.value); setError(""); }}
        placeholder="e.g. Problem set 4"
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
      />

      <label className="text-xs font-medium text-slate-500 mb-1 block">Course</label>
      {courses.length === 0 ? (
        <p className="text-xs text-slate-400 mb-3">Add a course first.</p>
      ) : (
        <select
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
        >
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}

      <label className="text-xs font-medium text-slate-500 mb-1 block">Due date</label>
      <input
        type="datetime-local"
        value={due}
        onChange={(e) => { setDue(e.target.value); setError(""); }}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-1 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
      />
      {error && <p className="text-xs text-rose-500 mb-2">{error}</p>}

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3.5 py-2 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-50">Cancel</button>
        <button
          onClick={() => {
            if (!title.trim()) { setError("Enter a title first."); return; }
            if (!courseId) { setError("Add a course first."); return; }
            if (!due) { setError("Pick a due date first."); return; }
            onSave({ title: title.trim(), courseId, due: new Date(due).toISOString() });
          }}
          className="px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
        >
          Add assignment
        </button>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-slate-900/30 flex items-center justify-center z-50 px-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-900 text-sm">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
