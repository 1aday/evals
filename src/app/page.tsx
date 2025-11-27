'use client';

import { useState, useCallback, Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FileUpload } from '@/components/file-upload';
import { TranscriptViewer } from '@/components/transcript-viewer';
import { TranscriptMessage, ParticipantRole } from '@/types/transcript';
import { useProjects, Project, useProjectTranscript } from '@/hooks/use-supabase';

// Loading fallback for Suspense
function TranscriptLoading() {
  return (
    <div className="h-full flex items-center justify-center bg-stone-50">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center animate-pulse">
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <p className="text-sm text-stone-500">Loading...</p>
      </div>
    </div>
  );
}

// Legend dot with gradient
function LegendDot({ role }: { role: ParticipantRole }) {
  const gradients: Record<ParticipantRole, string> = {
    user: 'from-teal-400 to-emerald-500',
    moderator: 'from-amber-400 to-orange-500',
    claude: 'from-violet-500 to-purple-600',
    gpt: 'from-sky-400 to-blue-500',
  };
  return <div className={`w-2.5 h-2.5 rounded-full bg-gradient-to-br ${gradients[role]}`} />;
}

// Project color options
const PROJECT_COLORS = [
  { name: 'indigo', gradient: 'from-indigo-500 to-purple-600', bg: 'bg-indigo-500' },
  { name: 'emerald', gradient: 'from-emerald-500 to-teal-600', bg: 'bg-emerald-500' },
  { name: 'amber', gradient: 'from-amber-500 to-orange-600', bg: 'bg-amber-500' },
  { name: 'rose', gradient: 'from-rose-500 to-pink-600', bg: 'bg-rose-500' },
  { name: 'sky', gradient: 'from-sky-500 to-blue-600', bg: 'bg-sky-500' },
  { name: 'violet', gradient: 'from-violet-500 to-purple-600', bg: 'bg-violet-500' },
];

// Project icon options
const PROJECT_ICONS = [
  { name: 'folder', icon: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  )},
  { name: 'chat', icon: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  )},
  { name: 'beaker', icon: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
    </svg>
  )},
  { name: 'lightning', icon: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  )},
  { name: 'star', icon: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
    </svg>
  )},
  { name: 'cube', icon: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  )},
];

function getProjectGradient(color: string) {
  return PROJECT_COLORS.find(c => c.name === color)?.gradient || 'from-indigo-500 to-purple-600';
}

function getProjectIcon(iconName: string) {
  return PROJECT_ICONS.find(i => i.name === iconName)?.icon || PROJECT_ICONS[0].icon;
}

function formatRelativeTime(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// Project Selector Component
function ProjectSelector({ 
  projects, 
  isLoading, 
  onSelect, 
  onCreate 
}: { 
  projects: Project[];
  isLoading: boolean;
  onSelect: (project: Project) => void;
  onCreate: (name: string, description?: string, color?: string, icon?: string) => Promise<Project | null>;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('folder');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    
    setIsCreating(true);
    const project = await onCreate(newName.trim(), undefined, 'indigo', newIcon);
    setIsCreating(false);
    
    if (project) {
      onSelect(project);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-full bg-gradient-to-br from-stone-50 via-stone-100 to-stone-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center animate-pulse">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <p className="text-sm text-stone-500">Loading projects...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gradient-to-br from-stone-50 via-stone-100 to-stone-50 p-6 sm:p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <header className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-xl shadow-indigo-500/25 mb-6">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h1 className="text-[28px] font-bold text-stone-800 tracking-tight mb-2">
            Debate Viewer
          </h1>
          <p className="text-[15px] text-stone-500 leading-relaxed">
            Select a project or create a new one to get started
          </p>
        </header>

        {/* Create New Project Card */}
        {!showCreate ? (
          <button
            onClick={() => setShowCreate(true)}
            className="w-full mb-6 p-5 bg-white border-2 border-dashed border-stone-200 rounded-2xl hover:border-indigo-300 hover:bg-indigo-50/30 transition-all group"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-stone-100 group-hover:bg-indigo-100 flex items-center justify-center transition-colors">
                <svg className="w-6 h-6 text-stone-400 group-hover:text-indigo-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <div className="text-left">
                <p className="text-[15px] font-semibold text-stone-700 group-hover:text-indigo-700 transition-colors">
                  Create New Project
                </p>
                <p className="text-[13px] text-stone-500">
                  Start fresh with a new evaluation project
                </p>
              </div>
            </div>
          </button>
        ) : (
          <div className="mb-6 p-6 bg-white border border-stone-200 rounded-2xl shadow-lg">
            <h3 className="text-[16px] font-semibold text-stone-800 mb-4">New Project</h3>
            
            {/* Name input */}
            <div className="mb-5">
              <label className="block text-[12px] font-semibold text-stone-500 uppercase tracking-wide mb-2">
                Project Name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g., GPT-5 Debate Analysis"
                className="w-full px-4 py-3 text-[15px] bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 placeholder:text-stone-400"
                autoFocus
              />
            </div>

            {/* Icon selector */}
            <div className="mb-5">
              <label className="block text-[12px] font-semibold text-stone-500 uppercase tracking-wide mb-2">
                Icon
              </label>
              <div className="flex gap-2">
                {PROJECT_ICONS.map((icon) => (
                  <button
                    key={icon.name}
                    onClick={() => setNewIcon(icon.name)}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                      newIcon === icon.name 
                        ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white scale-110 shadow-md' 
                        : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                    }`}
                  >
                    {icon.icon}
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowCreate(false);
                  setNewName('');
                  setNewIcon('folder');
                }}
                className="flex-1 py-3 px-4 text-[14px] font-medium text-stone-600 bg-stone-100 hover:bg-stone-200 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || isCreating}
                className={`flex-1 py-3 px-4 text-[14px] font-semibold text-white rounded-xl transition-all flex items-center justify-center gap-2 ${
                  newName.trim() && !isCreating
                    ? 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:shadow-lg hover:scale-[1.02]'
                    : 'bg-stone-300 cursor-not-allowed'
                }`}
              >
                {isCreating ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Creating...
                  </>
                ) : (
                  'Create Project'
                )}
              </button>
            </div>
          </div>
        )}

        {/* Existing Projects */}
        {projects.length > 0 && (
          <div>
            <h2 className="text-[13px] font-semibold text-stone-500 uppercase tracking-wide mb-4">
              Your Projects ({projects.length})
            </h2>
            <div className="space-y-3">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => onSelect(project)}
                  className="w-full p-4 bg-white border border-stone-200 rounded-2xl hover:border-stone-300 hover:shadow-md transition-all group text-left"
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${getProjectGradient(project.color)} flex items-center justify-center text-white shadow-md group-hover:scale-105 transition-transform`}>
                      {getProjectIcon(project.icon)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[15px] font-semibold text-stone-800 truncate">
                          {project.name}
                        </p>
                      </div>
                      <p className="text-[13px] text-stone-500 truncate">
                        {project.description || 'No description'}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[12px] text-stone-400">
                        {formatRelativeTime(project.updated_at)}
                      </p>
                      <svg className="w-5 h-5 text-stone-300 group-hover:text-stone-500 ml-auto mt-1 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {projects.length === 0 && !showCreate && (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-stone-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <p className="text-[15px] text-stone-600 mb-2">No projects yet</p>
            <p className="text-[13px] text-stone-400">Create your first project to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const { projects, currentProject, isLoading, createProject, selectProject, clearProject } = useProjects();
  const { transcript: savedTranscript, isLoading: transcriptLoading, saveTranscript, clearTranscript } = useProjectTranscript(currentProject?.id);
  
  const [transcript, setTranscript] = useState<TranscriptMessage[] | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [isLoadingDemo, setIsLoadingDemo] = useState(false);

  // Auto-load saved transcript when project changes
  useEffect(() => {
    if (savedTranscript && savedTranscript.data) {
      setTranscript(savedTranscript.data as TranscriptMessage[]);
      setFileName(savedTranscript.name);
    } else if (!transcriptLoading) {
      setTranscript(null);
      setFileName('');
    }
  }, [savedTranscript, transcriptLoading]);

  const handleFileLoaded = async (data: unknown, name: string) => {
    if (Array.isArray(data)) {
      const messages = data as TranscriptMessage[];
      setTranscript(messages);
      setFileName(name);
      
      // Calculate duration
      const start = messages[0]?.timestamp ? new Date(messages[0].timestamp) : null;
      const end = messages[messages.length - 1]?.timestamp ? new Date(messages[messages.length - 1].timestamp) : null;
      let duration = '';
      if (start && end) {
        const diff = end.getTime() - start.getTime();
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        duration = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      }
      
      // Save to project
      await saveTranscript(name, messages, messages.length, duration);
      
      router.push('/', { scroll: false });
    }
  };

  const handleReset = async () => {
    setTranscript(null);
    setFileName('');
    await clearTranscript();
  };

  const handleBackToProjects = () => {
    setTranscript(null);
    setFileName('');
    clearProject();
  };

  const handleLoadDemo = useCallback(async () => {
    setIsLoadingDemo(true);
    try {
      const response = await fetch('/demo.json');
      if (!response.ok) throw new Error('Failed to load demo');
      const data = await response.json();
      if (Array.isArray(data)) {
        const messages = data as TranscriptMessage[];
        setTranscript(messages);
        setFileName('demo.json');
        
        // Calculate duration
        const start = messages[0]?.timestamp ? new Date(messages[0].timestamp) : null;
        const end = messages[messages.length - 1]?.timestamp ? new Date(messages[messages.length - 1].timestamp) : null;
        let duration = '';
        if (start && end) {
          const diff = end.getTime() - start.getTime();
          const mins = Math.floor(diff / 60000);
          const secs = Math.floor((diff % 60000) / 1000);
          duration = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        }
        
        // Save to project
        await saveTranscript('demo.json', messages, messages.length, duration);
        
        router.push('/', { scroll: false });
      }
    } catch (error) {
      console.error('Failed to load demo:', error);
    } finally {
      setIsLoadingDemo(false);
    }
  }, [router, saveTranscript]);

  // Show transcript viewer if we have a transcript loaded
  if (transcript && currentProject) {
    return (
      <Suspense fallback={<TranscriptLoading />}>
        <TranscriptViewer 
          messages={transcript} 
          fileName={fileName} 
          onReset={handleReset}
          projectId={currentProject.id}
          projectName={currentProject.name}
          onBackToProjects={handleBackToProjects}
        />
      </Suspense>
    );
  }

  // Show project selector if no project selected
  if (!currentProject) {
    return (
      <ProjectSelector
        projects={projects}
        isLoading={isLoading}
        onSelect={selectProject}
        onCreate={createProject}
      />
    );
  }

  // Show file upload for selected project
  return (
    <main className="min-h-full bg-gradient-to-b from-stone-50 to-stone-100/50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Project header */}
        <button
          onClick={handleBackToProjects}
          className="mb-8 flex items-center gap-2 text-[13px] text-stone-500 hover:text-stone-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to projects
        </button>

        {/* Hero */}
        <header className="text-center mb-10">
          {/* Project icon */}
          <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br ${getProjectGradient(currentProject.color)} shadow-xl mb-6 text-white`}>
            {getProjectIcon(currentProject.icon)}
          </div>
          
          <h1 className="text-[24px] font-bold text-stone-800 tracking-tight mb-1">
            {currentProject.name}
          </h1>
          
          {currentProject.description && (
            <p className="text-[14px] text-stone-500 mb-4">
              {currentProject.description}
            </p>
          )}
          
          <p className="text-[15px] text-stone-500 leading-relaxed">
            Upload a transcript to analyze
          </p>
        </header>

        {/* Upload */}
        <FileUpload onFileLoaded={handleFileLoaded} />

        {/* Demo button */}
        <div className="mt-5 text-center">
          <button
            onClick={handleLoadDemo}
            disabled={isLoadingDemo}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-[14px] font-semibold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-all disabled:opacity-50"
          >
            {isLoadingDemo ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Try demo transcript
              </>
            )}
          </button>
        </div>

        {/* Legend */}
        <footer className="mt-12 flex items-center justify-center gap-6 text-[13px] text-stone-400">
          <span className="flex items-center gap-2">
            <LegendDot role="user" />
            <span>User</span>
          </span>
          <span className="flex items-center gap-2">
            <LegendDot role="moderator" />
            <span>Moderator</span>
          </span>
          <span className="flex items-center gap-2">
            <LegendDot role="claude" />
            <span>Claude</span>
          </span>
          <span className="flex items-center gap-2">
            <LegendDot role="gpt" />
            <span>GPT</span>
          </span>
        </footer>
      </div>
    </main>
  );
}
