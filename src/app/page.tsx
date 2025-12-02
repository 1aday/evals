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
    <div className="mobile-full-height flex items-center justify-center bg-stone-50 safe-bottom">
      <div className="flex flex-col items-center gap-4 px-6">
        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center animate-pulse-soft shadow-lg shadow-indigo-500/20">
          <svg className="w-7 h-7 sm:w-8 sm:h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <p className="text-base sm:text-lg text-stone-500 font-medium">Loading transcript...</p>
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
  return <div className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-gradient-to-br ${gradients[role]} flex-shrink-0`} />;
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
    <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  )},
  { name: 'chat', icon: (
    <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  )},
  { name: 'beaker', icon: (
    <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
    </svg>
  )},
  { name: 'lightning', icon: (
    <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  )},
  { name: 'star', icon: (
    <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
    </svg>
  )},
  { name: 'cube', icon: (
    <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
      <div className="mobile-full-height bg-gradient-to-br from-stone-50 via-stone-100 to-stone-50 flex items-center justify-center safe-bottom">
        <div className="flex flex-col items-center gap-4 px-6">
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center animate-pulse-soft shadow-lg">
            <svg className="w-7 h-7 sm:w-8 sm:h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <p className="text-base sm:text-lg text-stone-500 font-medium">Loading projects...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-full-height bg-gradient-to-br from-stone-50 via-stone-100 to-stone-50 overflow-y-auto safe-top safe-bottom">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Header */}
        <header className="text-center mb-8 sm:mb-12 animate-fade-in">
          <div className="inline-flex items-center justify-center w-14 h-14 sm:w-18 sm:h-18 rounded-2xl sm:rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-xl shadow-indigo-500/25 mb-4 sm:mb-6">
            <svg className="w-7 h-7 sm:w-9 sm:h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h1 className="text-[26px] sm:text-3xl font-bold text-stone-800 tracking-tight mb-3">
            Debate Viewer
          </h1>
          <p className="text-base sm:text-lg text-stone-500 leading-relaxed max-w-sm mx-auto">
            Select a project or create a new one to get started
          </p>
        </header>

        {/* Create New Project Card */}
        {!showCreate ? (
          <button
            onClick={() => setShowCreate(true)}
            className="w-full mb-6 p-4 sm:p-5 bg-white border-2 border-dashed border-stone-200 rounded-2xl hover:border-indigo-300 hover:bg-indigo-50/30 active:scale-[0.99] transition-all group"
          >
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-stone-100 group-hover:bg-indigo-100 flex items-center justify-center transition-colors flex-shrink-0">
                <svg className="w-5 h-5 sm:w-6 sm:h-6 text-stone-400 group-hover:text-indigo-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <div className="text-left min-w-0">
                <p className="text-[15px] sm:text-base font-semibold text-stone-700 group-hover:text-indigo-700 transition-colors">
                  Create New Project
                </p>
                <p className="text-sm sm:text-[15px] text-stone-500 truncate">
                  Start fresh with a new evaluation
                </p>
              </div>
            </div>
          </button>
        ) : (
          <div className="mb-6 p-5 sm:p-6 bg-white border border-stone-200 rounded-2xl shadow-lg animate-fade-in">
            <h3 className="text-lg sm:text-xl font-semibold text-stone-800 mb-5">New Project</h3>
            
            {/* Name input */}
            <div className="mb-5">
              <label className="block text-xs sm:text-sm font-semibold text-stone-500 uppercase tracking-wide mb-2">
                Project Name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g., GPT-5 Debate Analysis"
                className="w-full px-4 py-3.5 sm:py-4 text-base sm:text-[17px] bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 placeholder:text-stone-400"
                autoFocus
              />
            </div>

            {/* Icon selector */}
            <div className="mb-5">
              <label className="block text-xs sm:text-sm font-semibold text-stone-500 uppercase tracking-wide mb-2">
                Icon
              </label>
              <div className="flex gap-2 flex-wrap">
                {PROJECT_ICONS.map((icon) => (
                  <button
                    key={icon.name}
                    type="button"
                    onClick={() => setNewIcon(icon.name)}
                    className={`w-11 h-11 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center transition-all btn-press ${
                      newIcon === icon.name 
                        ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white scale-105 shadow-md' 
                        : 'bg-stone-100 text-stone-500 hover:bg-stone-200 active:bg-stone-300'
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
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  setNewName('');
                  setNewIcon('folder');
                }}
                className="flex-1 py-3.5 sm:py-4 px-4 text-[15px] sm:text-base font-medium text-stone-600 bg-stone-100 hover:bg-stone-200 active:bg-stone-300 rounded-xl transition-colors btn-press"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={!newName.trim() || isCreating}
                className={`flex-1 py-3.5 sm:py-4 px-4 text-[15px] sm:text-base font-semibold text-white rounded-xl transition-all flex items-center justify-center gap-2 btn-press ${
                  newName.trim() && !isCreating
                    ? 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:shadow-lg active:scale-[0.98]'
                    : 'bg-stone-300 cursor-not-allowed'
                }`}
              >
                {isCreating ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span>Creating...</span>
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
          <div className="stagger-children">
            <h2 className="text-sm sm:text-[15px] font-semibold text-stone-500 uppercase tracking-wide mb-4 sm:mb-5">
              Your Projects ({projects.length})
            </h2>
            <div className="space-y-3 sm:space-y-4">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => onSelect(project)}
                  className="w-full p-4 sm:p-5 bg-white border border-stone-200 rounded-xl sm:rounded-2xl hover:border-stone-300 hover:shadow-md active:scale-[0.99] transition-all group text-left"
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-gradient-to-br ${getProjectGradient(project.color)} flex items-center justify-center text-white shadow-md group-hover:scale-105 transition-transform flex-shrink-0`}>
                      {getProjectIcon(project.icon)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-base sm:text-lg font-semibold text-stone-800 truncate">
                        {project.name}
                      </p>
                      <p className="text-sm sm:text-[15px] text-stone-500 truncate">
                        {project.description || 'No description'}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0 flex items-center gap-2">
                      <p className="text-xs sm:text-sm text-stone-400 hidden sm:block">
                        {formatRelativeTime(project.updated_at)}
                      </p>
                      <svg className="w-5 h-5 sm:w-6 sm:h-6 text-stone-300 group-hover:text-stone-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
          <div className="text-center py-10 sm:py-12 animate-fade-in">
            <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-5 rounded-full bg-stone-100 flex items-center justify-center">
              <svg className="w-8 h-8 sm:w-10 sm:h-10 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <p className="text-base sm:text-lg text-stone-600 mb-2 font-medium">No projects yet</p>
            <p className="text-sm sm:text-base text-stone-400">Create your first project to get started</p>
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
    <main className="mobile-full-height bg-gradient-to-b from-stone-50 to-stone-100/50 flex items-center justify-center px-4 sm:px-6 py-8 safe-top safe-bottom overflow-y-auto">
      <div className="w-full max-w-md animate-fade-in">
        {/* Back button */}
        <button
          onClick={handleBackToProjects}
          className="mb-6 sm:mb-8 flex items-center gap-2 text-sm sm:text-base text-stone-500 hover:text-stone-700 active:text-stone-800 transition-colors -ml-1 py-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          <span>Back to projects</span>
        </button>

        {/* Hero */}
        <header className="text-center mb-8 sm:mb-10">
          {/* Project icon */}
          <div className={`inline-flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br ${getProjectGradient(currentProject.color)} shadow-xl mb-4 sm:mb-6 text-white`}>
            {getProjectIcon(currentProject.icon)}
          </div>
          
          <h1 className="text-2xl sm:text-3xl font-bold text-stone-800 tracking-tight mb-2">
            {currentProject.name}
          </h1>
          
          {currentProject.description && (
            <p className="text-sm sm:text-base text-stone-500 mb-3 sm:mb-4">
              {currentProject.description}
            </p>
          )}
          
          <p className="text-base sm:text-lg text-stone-500 leading-relaxed">
            Upload a transcript to analyze
          </p>
        </header>

        {/* Upload */}
        <FileUpload onFileLoaded={handleFileLoaded} />

        {/* Demo button */}
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={handleLoadDemo}
            disabled={isLoadingDemo}
            className="inline-flex items-center gap-2 px-5 sm:px-6 py-3 sm:py-3.5 text-sm sm:text-base font-semibold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 active:bg-indigo-200 rounded-xl transition-all disabled:opacity-50 btn-press"
          >
            {isLoadingDemo ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>Loading...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>Try demo transcript</span>
              </>
            )}
          </button>
        </div>

        {/* Legend - wraps on mobile */}
        <footer className="mt-10 sm:mt-12 flex flex-wrap items-center justify-center gap-x-5 sm:gap-x-6 gap-y-3 text-sm sm:text-base text-stone-400">
          <span className="flex items-center gap-1.5 sm:gap-2">
            <LegendDot role="user" />
            <span>User</span>
          </span>
          <span className="flex items-center gap-1.5 sm:gap-2">
            <LegendDot role="moderator" />
            <span>Maude</span>
          </span>
          <span className="flex items-center gap-1.5 sm:gap-2">
            <LegendDot role="claude" />
            <span>Catherine</span>
          </span>
          <span className="flex items-center gap-1.5 sm:gap-2">
            <LegendDot role="gpt" />
            <span>Gordon</span>
          </span>
        </footer>
      </div>
    </main>
  );
}
