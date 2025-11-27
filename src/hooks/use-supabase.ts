'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

// =============================================
// Projects Hook
// =============================================
export interface Project {
  id: string;
  name: string;
  description?: string;
  color: string;
  icon: string;
  created_at: string;
  updated_at: string;
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load projects on mount
  useEffect(() => {
    async function loadProjects() {
      if (!isSupabaseConfigured) {
        setIsLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('projects')
          .select('*')
          .order('updated_at', { ascending: false });

        if (error) {
          console.error('Error loading projects:', error);
          return;
        }

        if (data) {
          setProjects(data);
        }
      } catch (err) {
        console.error('Failed to load projects:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadProjects();
  }, []);

  // Load last used project from settings
  useEffect(() => {
    async function loadLastProject() {
      if (!isSupabaseConfigured || projects.length === 0) return;

      try {
        const { data } = await supabase
          .from('user_settings')
          .select('last_project_id')
          .limit(1)
          .single();

        if (data?.last_project_id) {
          const lastProject = projects.find(p => p.id === data.last_project_id);
          if (lastProject) {
            setCurrentProject(lastProject);
          }
        }
      } catch (err) {
        // Ignore - no last project
      }
    }

    loadLastProject();
  }, [projects]);

  // Create a new project
  const createProject = useCallback(async (
    name: string, 
    description?: string, 
    color: string = 'indigo',
    icon: string = 'folder'
  ) => {
    if (!isSupabaseConfigured) {
      console.warn('Supabase not configured - creating local project');
      // Create a local-only project when Supabase isn't available
      const localProject: Project = {
        id: `local-${Date.now()}`,
        name,
        description: description || '',
        color,
        icon,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setProjects(prev => [localProject, ...prev]);
      setCurrentProject(localProject);
      return localProject;
    }

    try {
      const { data, error } = await supabase
        .from('projects')
        .insert({ name, description, color, icon })
        .select()
        .single();

      if (error) {
        console.error('Error creating project:', error.message, error.details, error.hint);
        // If table doesn't exist, create a local project instead
        if (error.code === '42P01' || error.message?.includes('does not exist')) {
          console.warn('Projects table not found - run the SQL schema in Supabase. Creating local project.');
          const localProject: Project = {
            id: `local-${Date.now()}`,
            name,
            description: description || '',
            color,
            icon,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          setProjects(prev => [localProject, ...prev]);
          setCurrentProject(localProject);
          return localProject;
        }
        return null;
      }

      if (data) {
        setProjects(prev => [data, ...prev]);
        setCurrentProject(data);
        
        // Save as last project
        await supabase
          .from('user_settings')
          .update({ last_project_id: data.id })
          .neq('id', '00000000-0000-0000-0000-000000000000'); // Update any row
        
        return data;
      }
      return null;
    } catch (err) {
      console.error('Failed to create project:', err);
      // Fallback to local project
      const localProject: Project = {
        id: `local-${Date.now()}`,
        name,
        description: description || '',
        color,
        icon,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setProjects(prev => [localProject, ...prev]);
      setCurrentProject(localProject);
      return localProject;
    }
  }, []);

  // Select a project
  const selectProject = useCallback(async (project: Project) => {
    setCurrentProject(project);

    if (!isSupabaseConfigured) return;

    // Update last used project in settings
    try {
      const { data: existing } = await supabase
        .from('user_settings')
        .select('id')
        .limit(1)
        .single();

      if (existing) {
        await supabase
          .from('user_settings')
          .update({ last_project_id: project.id })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('user_settings')
          .insert({ last_project_id: project.id, settings: {} });
      }

      // Update project's updated_at
      await supabase
        .from('projects')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', project.id);

      // Move to top of list
      setProjects(prev => {
        const updated = prev.filter(p => p.id !== project.id);
        return [{ ...project, updated_at: new Date().toISOString() }, ...updated];
      });
    } catch (err) {
      console.error('Failed to update last project:', err);
    }
  }, []);

  // Update a project
  const updateProject = useCallback(async (
    id: string, 
    updates: Partial<Pick<Project, 'name' | 'description' | 'color' | 'icon'>>
  ) => {
    if (!isSupabaseConfigured) return false;

    try {
      const { error } = await supabase
        .from('projects')
        .update(updates)
        .eq('id', id);

      if (error) {
        console.error('Error updating project:', error);
        return false;
      }

      setProjects(prev => prev.map(p => 
        p.id === id ? { ...p, ...updates } : p
      ));

      if (currentProject?.id === id) {
        setCurrentProject(prev => prev ? { ...prev, ...updates } : null);
      }

      return true;
    } catch (err) {
      console.error('Failed to update project:', err);
      return false;
    }
  }, [currentProject]);

  // Delete a project
  const deleteProject = useCallback(async (id: string) => {
    if (!isSupabaseConfigured) return false;

    try {
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error deleting project:', error);
        return false;
      }

      setProjects(prev => prev.filter(p => p.id !== id));
      
      if (currentProject?.id === id) {
        setCurrentProject(null);
      }

      return true;
    } catch (err) {
      console.error('Failed to delete project:', err);
      return false;
    }
  }, [currentProject]);

  // Clear current project (go back to project list)
  const clearProject = useCallback(() => {
    setCurrentProject(null);
  }, []);

  return {
    projects,
    currentProject,
    isLoading,
    createProject,
    selectProject,
    updateProject,
    deleteProject,
    clearProject,
  };
}

// =============================================
// System Prompts Hook (Project-scoped)
// =============================================
export function useSystemPrompts(defaultPrompts: Record<string, string>, projectId?: string | null) {
  const [prompts, setPrompts] = useState<Record<string, string>>(defaultPrompts);
  const [isLoading, setIsLoading] = useState(true);
  const [isSynced, setIsSynced] = useState(false);

  // Load prompts from Supabase when project changes
  useEffect(() => {
    async function loadPrompts() {
      if (!isSupabaseConfigured || !projectId) {
        setPrompts(defaultPrompts);
        setIsLoading(false);
        setIsSynced(!projectId); // Synced if no project (using defaults)
        return;
      }

      try {
        const { data, error } = await supabase
          .from('system_prompts')
          .select('model, prompt')
          .eq('project_id', projectId);

        if (error) {
          console.error('Error loading prompts:', error);
          return;
        }

        const loadedPrompts: Record<string, string> = { ...defaultPrompts };
        if (data && data.length > 0) {
          data.forEach((row) => {
            loadedPrompts[row.model] = row.prompt;
          });
        }
        setPrompts(loadedPrompts);
        setIsSynced(true);
      } catch (err) {
        console.error('Failed to load prompts:', err);
      } finally {
        setIsLoading(false);
      }
    }

    setIsLoading(true);
    loadPrompts();
  }, [defaultPrompts, projectId]);

  // Save a prompt to Supabase
  const savePrompt = useCallback(async (model: string, prompt: string) => {
    setPrompts(prev => ({ ...prev, [model]: prompt }));

    if (!isSupabaseConfigured || !projectId) return true;

    try {
      const { error } = await supabase
        .from('system_prompts')
        .upsert(
          { project_id: projectId, model, prompt },
          { onConflict: 'project_id,model' }
        );

      if (error) {
        console.error('Error saving prompt:', error);
        return false;
      }
      return true;
    } catch (err) {
      console.error('Failed to save prompt:', err);
      return false;
    }
  }, [projectId]);

  // Reset a prompt to default
  const resetPrompt = useCallback(async (model: string) => {
    const defaultPrompt = defaultPrompts[model];
    setPrompts(prev => ({ ...prev, [model]: defaultPrompt }));

    if (!isSupabaseConfigured || !projectId) return true;

    try {
      const { error } = await supabase
        .from('system_prompts')
        .delete()
        .eq('project_id', projectId)
        .eq('model', model);

      if (error) {
        console.error('Error resetting prompt:', error);
        return false;
      }
      return true;
    } catch (err) {
      console.error('Failed to reset prompt:', err);
      return false;
    }
  }, [defaultPrompts, projectId]);

  return { prompts, isLoading, isSynced, savePrompt, resetPrompt };
}

// =============================================
// Chat History Hook (Project-scoped)
// =============================================
export interface ChatMessageData {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  isStreaming?: boolean;
  searchStatus?: {
    searching: boolean;
    completed: boolean;
    sources?: { url: string; title: string }[];
  };
  citations?: { url: string; title: string; start_index: number; end_index: number }[];
}

export function useProjectChat(projectId?: string | null) {
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Load or create chat session for project
  useEffect(() => {
    async function loadChat() {
      console.log('[Chat] useProjectChat loading for projectId:', projectId);
      
      if (!projectId) {
        console.log('[Chat] No projectId provided');
        setMessages([]);
        setSessionId(null);
        setIsLoading(false);
        return;
      }

      // Handle local projects
      if (projectId.startsWith('local-')) {
        const stored = localStorage.getItem(`chat-${projectId}`);
        if (stored) {
          try {
            const data = JSON.parse(stored);
            console.log('[Chat] Loaded', (data.messages || []).length, 'messages from localStorage for local project');
            setMessages(data.messages || []);
            setSessionId(data.sessionId || `local-session-${projectId}`);
          } catch {
            console.log('[Chat] Failed to parse localStorage data');
            setMessages([]);
            setSessionId(`local-session-${projectId}`);
          }
        } else {
          console.log('[Chat] No stored messages for local project');
          setMessages([]);
          setSessionId(`local-session-${projectId}`);
        }
        setIsLoading(false);
        return;
      }

      if (!isSupabaseConfigured) {
        setIsLoading(false);
        return;
      }

      try {
        // Find existing session for project
        const { data: session, error: sessionError } = await supabase
          .from('chat_sessions')
          .select('*')
          .eq('project_id', projectId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .single();

        if (sessionError && sessionError.code !== 'PGRST116') {
          console.error('Error loading session:', sessionError);
        }

        if (session) {
          setSessionId(session.id);
          console.log('[Chat] Found existing session:', session.id);
          
          // Load messages for this session
          const { data: msgs, error: msgsError } = await supabase
            .from('chat_messages')
            .select('*')
            .eq('session_id', session.id)
            .order('created_at', { ascending: true });

          if (msgsError) {
            console.error('[Chat] Error loading messages:', msgsError);
          }

          if (msgs && msgs.length > 0) {
            console.log('[Chat] Loaded', msgs.length, 'messages from Supabase');
            setMessages(msgs.map(m => ({
              id: m.id,
              role: m.role,
              content: m.content,
              thinking: m.thinking,
              searchStatus: m.search_status,
              citations: m.citations,
            })));
          } else {
            console.log('[Chat] No messages found for session');
          }
        } else {
          // Create new session
          const { data: newSession, error: createError } = await supabase
            .from('chat_sessions')
            .insert({ project_id: projectId, title: 'Chat' })
            .select()
            .single();

          if (createError) {
            console.error('Error creating session:', createError);
            setSessionId(`local-session-${projectId}`);
          } else if (newSession) {
            setSessionId(newSession.id);
          }
          setMessages([]);
        }
      } catch (err) {
        console.error('Failed to load chat:', err);
      } finally {
        setIsLoading(false);
      }
    }

    setIsLoading(true);
    loadChat();
  }, [projectId]);

  // Save messages (debounced for streaming)
  const saveMessages = useCallback(async (newMessages: ChatMessageData[]) => {
    if (!projectId) {
      console.log('[Chat] No projectId, skipping save');
      return;
    }
    if (!sessionId) {
      console.log('[Chat] No sessionId yet, skipping save (will retry when session is ready)');
      return;
    }

    // Filter out streaming messages
    const completedMessages = newMessages.filter(m => !m.isStreaming);
    
    if (completedMessages.length === 0) {
      return;
    }

    console.log('[Chat] Saving', completedMessages.length, 'messages to', projectId.startsWith('local-') ? 'localStorage' : 'Supabase');

    // Handle local projects
    if (projectId.startsWith('local-') || !isSupabaseConfigured) {
      localStorage.setItem(`chat-${projectId}`, JSON.stringify({
        sessionId,
        messages: completedMessages,
      }));
      console.log('[Chat] Saved to localStorage');
      return;
    }

    // Save to Supabase
    for (const msg of completedMessages) {
      try {
        // Check if this ID looks like a UUID or a timestamp
        const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(msg.id);
        
        const { error } = await supabase
          .from('chat_messages')
          .upsert({
            // Let Supabase generate UUID if the ID is not a valid UUID
            id: isValidUUID ? msg.id : undefined,
            session_id: sessionId,
            role: msg.role,
            content: msg.content,
            thinking: msg.thinking,
            search_status: msg.searchStatus,
            citations: msg.citations,
          });
        
        if (error) {
          console.error('[Chat] Error saving message:', error.message, error.details);
        } else {
          console.log('[Chat] Saved message', msg.id, 'role:', msg.role);
        }
      } catch (err) {
        console.error('[Chat] Exception saving message:', err);
      }
    }

    // Update session timestamp
    await supabase
      .from('chat_sessions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', sessionId);
  }, [projectId, sessionId]);

  // Track pending save for when session becomes ready
  const pendingMessagesRef = useRef<ChatMessageData[] | null>(null);
  
  // Effect to save pending messages when sessionId becomes available
  useEffect(() => {
    if (sessionId && pendingMessagesRef.current) {
      console.log('[Chat] Session ready, saving pending messages');
      saveMessages(pendingMessagesRef.current);
      pendingMessagesRef.current = null;
    }
  }, [sessionId, saveMessages]);

  // Update messages and save
  const updateMessages = useCallback((updater: ChatMessageData[] | ((prev: ChatMessageData[]) => ChatMessageData[])) => {
    setMessages(prev => {
      const newMessages = typeof updater === 'function' ? updater(prev) : updater;
      // Save after update (only completed messages)
      const hasCompleted = newMessages.some(m => !m.isStreaming);
      if (hasCompleted) {
        if (!sessionId) {
          // Store for later when session is ready
          console.log('[Chat] Queuing messages for save (session not ready)');
          pendingMessagesRef.current = newMessages;
        } else {
          saveMessages(newMessages);
        }
      }
      return newMessages;
    });
  }, [saveMessages, sessionId]);

  // Clear chat
  const clearChat = useCallback(async () => {
    setMessages([]);

    if (!projectId) return;

    if (projectId.startsWith('local-')) {
      localStorage.removeItem(`chat-${projectId}`);
      return;
    }

    if (isSupabaseConfigured && sessionId) {
      await supabase
        .from('chat_messages')
        .delete()
        .eq('session_id', sessionId);
    }
  }, [projectId, sessionId]);

  return {
    messages,
    setMessages: updateMessages,
    isLoading,
    clearChat,
  };
}

// =============================================
// Evaluation Results Hook (Project-scoped)  
// =============================================
export interface EvaluationResult {
  id: string;
  project_id: string;
  maude_response: string;
  chat_response: string;
  evaluation: string;
  created_at: string;
}

export function useProjectEvaluation(projectId?: string | null) {
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load evaluation for project
  useEffect(() => {
    async function load() {
      console.log('[Eval] Loading evaluation for project:', projectId);
      
      if (!projectId) {
        console.log('[Eval] No projectId, skipping load');
        setEvaluation(null);
        setIsLoading(false);
        return;
      }

      // Handle local projects
      if (projectId.startsWith('local-')) {
        const stored = localStorage.getItem(`evaluation-${projectId}`);
        console.log('[Eval] Local project, localStorage data:', stored ? 'found' : 'not found');
        if (stored) {
          try {
            setEvaluation(JSON.parse(stored));
          } catch {
            setEvaluation(null);
          }
        }
        setIsLoading(false);
        return;
      }

      // For now, just use localStorage for evaluations
      // Can add Supabase table later if needed
      const stored = localStorage.getItem(`evaluation-${projectId}`);
      console.log('[Eval] Supabase project, localStorage key:', `evaluation-${projectId}`, 'data:', stored ? 'found' : 'not found');
      if (stored) {
        try {
          setEvaluation(JSON.parse(stored));
        } catch {
          setEvaluation(null);
        }
      }
      setIsLoading(false);
    }

    setIsLoading(true);
    load();
  }, [projectId]);

  // Save evaluation
  const saveEvaluation = useCallback((maudeResponse: string, chatResponse: string, evaluationText: string) => {
    console.log('[Eval] saveEvaluation called, projectId:', projectId);
    if (!projectId) {
      console.log('[Eval] No projectId, skipping save');
      return;
    }

    const data: EvaluationResult = {
      id: `eval-${Date.now()}`,
      project_id: projectId,
      maude_response: maudeResponse,
      chat_response: chatResponse,
      evaluation: evaluationText,
      created_at: new Date().toISOString(),
    };

    const key = `evaluation-${projectId}`;
    console.log('[Eval] Saving to localStorage key:', key);
    localStorage.setItem(key, JSON.stringify(data));
    setEvaluation(data);
    console.log('[Eval] Saved successfully');
  }, [projectId]);

  // Clear evaluation
  const clearEvaluation = useCallback(() => {
    if (!projectId) return;
    localStorage.removeItem(`evaluation-${projectId}`);
    setEvaluation(null);
  }, [projectId]);

  return { evaluation, isLoading, saveEvaluation, clearEvaluation };
}

// =============================================
// User Settings Hook
// =============================================
interface UserSettings {
  model: 'gpt-5.1' | 'gpt-5' | 'gpt-5-mini' | 'gpt-5-nano';
  reasoningEffort: 'none' | 'minimal' | 'low' | 'medium' | 'high';
  verbosity: 'low' | 'medium' | 'high';
  webSearch: boolean;
}

const DEFAULT_SETTINGS: UserSettings = {
  model: 'gpt-5',
  reasoningEffort: 'medium',
  verbosity: 'medium',
  webSearch: true,
};

export function useUserSettings() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load settings on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const { data, error } = await supabase
          .from('user_settings')
          .select('*')
          .limit(1)
          .single();

        if (error && error.code !== 'PGRST116') {
          console.error('Error loading settings:', error);
          return;
        }

        if (data) {
          setSettingsId(data.id);
          setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadSettings();
  }, []);

  // Update settings
  const updateSettings = useCallback(async (newSettings: Partial<UserSettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);

    try {
      if (settingsId) {
        const { error } = await supabase
          .from('user_settings')
          .update({ settings: updated })
          .eq('id', settingsId);

        if (error) {
          console.error('Error updating settings:', error);
          return false;
        }
      } else {
        const { data, error } = await supabase
          .from('user_settings')
          .insert({ settings: updated })
          .select()
          .single();

        if (error) {
          console.error('Error creating settings:', error);
          return false;
        }

        if (data) {
          setSettingsId(data.id);
        }
      }
      return true;
    } catch (err) {
      console.error('Failed to update settings:', err);
      return false;
    }
  }, [settings, settingsId]);

  return { settings, isLoading, updateSettings };
}

// =============================================
// Saved Transcripts Hook (Project-scoped)
// =============================================
export interface SavedTranscript {
  id: string;
  project_id: string;
  name: string;
  data: unknown[];
  message_count: number;
  duration: string;
  created_at: string;
}

export function useProjectTranscript(projectId?: string | null) {
  const [transcript, setTranscript] = useState<SavedTranscript | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load transcript for project
  useEffect(() => {
    async function loadTranscript() {
      if (!projectId) {
        setTranscript(null);
        setIsLoading(false);
        return;
      }

      // Check localStorage first for local projects
      if (projectId.startsWith('local-')) {
        const stored = localStorage.getItem(`transcript-${projectId}`);
        if (stored) {
          try {
            setTranscript(JSON.parse(stored));
          } catch {
            // Invalid stored data
          }
        }
        setIsLoading(false);
        return;
      }

      if (!isSupabaseConfigured) {
        setIsLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('saved_transcripts')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (error && error.code !== 'PGRST116') {
          console.error('Error loading transcript:', error);
        }

        if (data) {
          setTranscript(data);
        } else {
          setTranscript(null);
        }
      } catch (err) {
        console.error('Failed to load transcript:', err);
      } finally {
        setIsLoading(false);
      }
    }

    setIsLoading(true);
    loadTranscript();
  }, [projectId]);

  // Save transcript for project
  const saveTranscript = useCallback(async (
    name: string, 
    data: unknown[], 
    messageCount: number, 
    duration: string
  ) => {
    if (!projectId) return null;

    const transcriptData: SavedTranscript = {
      id: `transcript-${Date.now()}`,
      project_id: projectId,
      name,
      data,
      message_count: messageCount,
      duration,
      created_at: new Date().toISOString(),
    };

    // Handle local projects
    if (projectId.startsWith('local-')) {
      localStorage.setItem(`transcript-${projectId}`, JSON.stringify(transcriptData));
      setTranscript(transcriptData);
      return transcriptData.id;
    }

    if (!isSupabaseConfigured) {
      setTranscript(transcriptData);
      return transcriptData.id;
    }

    try {
      // Delete existing transcript for this project first
      await supabase
        .from('saved_transcripts')
        .delete()
        .eq('project_id', projectId);

      // Insert new transcript
      const { data: saved, error } = await supabase
        .from('saved_transcripts')
        .insert({
          project_id: projectId,
          name,
          data,
          message_count: messageCount,
          duration,
        })
        .select()
        .single();

      if (error) {
        console.error('Error saving transcript:', error.message);
        // Fallback to local state
        setTranscript(transcriptData);
        return transcriptData.id;
      }

      if (saved) {
        setTranscript(saved);
        return saved.id;
      }
      return null;
    } catch (err) {
      console.error('Failed to save transcript:', err);
      setTranscript(transcriptData);
      return transcriptData.id;
    }
  }, [projectId]);

  // Clear transcript
  const clearTranscript = useCallback(async () => {
    if (!projectId) return;

    if (projectId.startsWith('local-')) {
      localStorage.removeItem(`transcript-${projectId}`);
      setTranscript(null);
      return;
    }

    if (isSupabaseConfigured) {
      await supabase
        .from('saved_transcripts')
        .delete()
        .eq('project_id', projectId);
    }
    
    setTranscript(null);
  }, [projectId]);

  return { transcript, isLoading, saveTranscript, clearTranscript };
}

