import React, { createContext, useContext, useEffect, useReducer, ReactNode } from 'react';
import { ResumeData, DEFAULT_COLORS, DEFAULT_SECTIONS } from '../types/resume';

interface ResumeState {
  resumeData: ResumeData;
  isEditing: boolean;
  selectedSection: string | null;
}

type ResumeAction =
  | { type: 'UPDATE_PERSONAL_INFO'; payload: Partial<ResumeData['personalInfo']> }
  | { type: 'UPDATE_SUMMARY'; payload: string }
  | { type: 'UPDATE_EXPERIENCE'; payload: ResumeData['experience'] }
  | { type: 'UPDATE_EDUCATION'; payload: ResumeData['education'] }
  | { type: 'UPDATE_PROJECTS'; payload: ResumeData['projects'] }
  | { type: 'UPDATE_SKILLS'; payload: ResumeData['skills'] }
  | { type: 'UPDATE_CUSTOM_SECTIONS'; payload: ResumeData['customSections'] }
  | { type: 'UPDATE_SECTIONS'; payload: ResumeData['sections'] }
  | { type: 'UPDATE_COLORS'; payload: ResumeData['colors'] }
  | { type: 'UPDATE_TEMPLATE'; payload: ResumeData['template'] }
  | { type: 'UPDATE_PAGE_FORMAT'; payload: ResumeData['pageFormat'] }
  | { type: 'UPDATE_FONT_SIZE'; payload: ResumeData['fontSize'] }
  | { type: 'UPDATE_FONT_FAMILY'; payload: ResumeData['fontFamily'] }
  | { type: 'SET_EDITING'; payload: boolean }
  | { type: 'SET_SELECTED_SECTION'; payload: string | null }
  | { type: 'RESET_RESUME' }
  | { type: 'IMPORT_RESUME_DATA'; payload: ResumeData };

const initialResumeData: ResumeData = {
  personalInfo: { fullName: '', jobTitle: '', email: '', phone: '', location: '', website: '', linkedin: '', github: '', profileImage: '', birthDate: '' },
  summary: '',
  experience: [],
  education: [],
  projects: [],
  skills: { mode: 'simple', simple: [], categorized: [] },
  customSections: [],
  sections: DEFAULT_SECTIONS.map(section => ({ ...section })),
  colors: { ...DEFAULT_COLORS, primary: '#262626', secondary: '#444444', accent: '#262626', text: '#222222', background: '#ffffff' },
  template: 'original-upload',
  pageFormat: 'letter',
  fontSize: 'medium',
  fontFamily: 'Arial'
};

const initialState: ResumeState = {
  resumeData: initialResumeData,
  isEditing: false,
  selectedSection: null
};

function resumeReducer(state: ResumeState, action: ResumeAction): ResumeState {
  switch (action.type) {
    case 'UPDATE_PERSONAL_INFO':
      return {
        ...state,
        resumeData: {
          ...state.resumeData,
          personalInfo: { ...state.resumeData.personalInfo, ...action.payload }
        }
      };
    case 'UPDATE_SUMMARY':
      return {
        ...state,
        resumeData: { ...state.resumeData, summary: action.payload }
      };
    case 'UPDATE_EXPERIENCE':
      return {
        ...state,
        resumeData: { ...state.resumeData, experience: action.payload }
      };
    case 'UPDATE_EDUCATION':
      return {
        ...state,
        resumeData: { ...state.resumeData, education: action.payload }
      };
    case 'UPDATE_PROJECTS':
      return {
        ...state,
        resumeData: { ...state.resumeData, projects: action.payload }
      };
    case 'UPDATE_SKILLS':
      return {
        ...state,
        resumeData: { ...state.resumeData, skills: action.payload }
      };
    case 'UPDATE_CUSTOM_SECTIONS':
      return {
        ...state,
        resumeData: { ...state.resumeData, customSections: action.payload }
      };
    case 'UPDATE_SECTIONS':
      return {
        ...state,
        resumeData: { ...state.resumeData, sections: action.payload }
      };
    case 'UPDATE_COLORS':
      return {
        ...state,
        resumeData: { ...state.resumeData, colors: action.payload }
      };
    case 'UPDATE_TEMPLATE': {
      const original = state.resumeData.originalTemplate;
      const nextOriginal = original
        ? {
            ...original,
            ...(action.payload === 'original-upload'
              ? {}
              : { editableTemplate: action.payload as Exclude<ResumeData['template'], 'original-upload'> })
          }
        : original;
      return {
        ...state,
        resumeData: { ...state.resumeData, template: action.payload, originalTemplate: nextOriginal }
      };
    }
    case 'UPDATE_PAGE_FORMAT':
      return {
        ...state,
        resumeData: { ...state.resumeData, pageFormat: action.payload }
      };
    case 'UPDATE_FONT_SIZE':
      return {
        ...state,
        resumeData: { ...state.resumeData, fontSize: action.payload }
      };
    case 'UPDATE_FONT_FAMILY':
      return {
        ...state,
        resumeData: { ...state.resumeData, fontFamily: action.payload }
      };
    case 'SET_EDITING':
      return { ...state, isEditing: action.payload };
    case 'SET_SELECTED_SECTION':
      return { ...state, selectedSection: action.payload };
    case 'RESET_RESUME':
      return { ...initialState, resumeData: initialResumeData };
    case 'IMPORT_RESUME_DATA':
      return { ...state, resumeData: action.payload };
    default:
      return state;
  }
}

interface ResumeContextType {
  state: ResumeState;
  dispatch: React.Dispatch<ResumeAction>;
  updatePersonalInfo: (data: Partial<ResumeData['personalInfo']>) => void;
  updateSummary: (summary: string) => void;
  updateExperience: (experience: ResumeData['experience']) => void;
  updateEducation: (education: ResumeData['education']) => void;
  updateProjects: (projects: ResumeData['projects']) => void;
  updateSkills: (skills: ResumeData['skills']) => void;
  updateCustomSections: (sections: ResumeData['customSections']) => void;
  updateSections: (sections: ResumeData['sections']) => void;
  updateColors: (colors: ResumeData['colors']) => void;
  updateTemplate: (template: ResumeData['template']) => void;
  updatePageFormat: (format: ResumeData['pageFormat']) => void;
  updateFontSize: (fontSize: ResumeData['fontSize']) => void;
  updateFontFamily: (fontFamily: ResumeData['fontFamily']) => void;
  setEditing: (editing: boolean) => void;
  setSelectedSection: (section: string | null) => void;
  resetResume: () => void;
  importResumeData: (data: ResumeData) => void;
  exportResumeData: () => ResumeData;
}

const ResumeContext = createContext<ResumeContextType | undefined>(undefined);

const loadPersistedState = (): ResumeState => {
  if (typeof window === 'undefined') return initialState;
  try {
    const raw = window.localStorage.getItem('resume-studio-resume-data');
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as ResumeData;
    if (!parsed || typeof parsed !== 'object' || !parsed.personalInfo || !Array.isArray(parsed.sections)) return initialState;
    // Never restore the synthetic E2E candidate into the user's real workspace.
    // Older E2E runs could persist E2E-Test-Resume in localStorage; clear that
    // stale fixture automatically so normal chat tailoring starts from the
    // user's actual upload.
    const name=String(parsed.personalInfo?.fullName||'').toLowerCase();
    const email=String(parsed.personalInfo?.email||'').toLowerCase();
    const source=String(parsed.originalTemplate?.sourceFileName||'').toLowerCase();
    const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
    const experience = Array.isArray(parsed.experience) ? parsed.experience : [];
    // Reject the unrelated sample resume that was accidentally bundled with
    // older builds. Never let that sample become the user's starting artifact.
    const unrelatedSample = email === 'afifahmad718@gmail.com' ||
      name.includes('mustahoshin hossain ahamed afif') ||
      experience.some((x:any) => /systemsage solutions|nestron house/i.test(String(x.company||''))) ||
      projects.some((x:any) => /systemsage solutions/i.test(String(x.title||'')));
    const seededDefault = source === 'badham_dileep_kumar_updated_resume.pdf' &&
      projects.some((p:any) => ['ai-career-assistant','samurai-reimei'].includes(String(p.id||'')));
    if (seededDefault || unrelatedSample) {
      window.localStorage.removeItem('resume-studio-resume-data');
      return initialState;
    }
    const company=(parsed.experience||[]).map((x:any)=>String(x.company||'').toLowerCase()).join(' ');
    const synthetic=email==='e2e@example.com' || name.includes('e2e test') || source.includes('e2e-test-resume') || company.includes('example technologies');
    if(synthetic){
      window.localStorage.removeItem('resume-studio-resume-data');
      return initialState;
    }
    // Migrate legacy imported resumes that retained blue styling/Helvetica.
    // This keeps an already-saved uploaded resume consistent with fresh imports.
    const migrated = parsed.originalTemplate ? {
      ...parsed,
      colors: { ...DEFAULT_COLORS, primary: '#262626', secondary: '#444444', accent: '#262626', text: '#222222', background: '#ffffff' },
      fontFamily: 'Arial',
      template: 'original-upload' as const,
    } : parsed;
    return { ...initialState, resumeData: migrated };
  } catch {
    return initialState;
  }
};

/**
 * `initialData` seeds the editor (used by the ATS builder's manual editor);
 * `persist={false}` keeps that editor out of the legacy localStorage slot.
 */
export const ResumeProvider: React.FC<{ children: ReactNode; initialData?: ResumeData; persist?: boolean; onChange?: (data: ResumeData) => void }> = ({ children, initialData, persist = true, onChange }) => {
  const [state, dispatch] = useReducer(resumeReducer, initialState, (init) => (initialData ? { ...init, resumeData: initialData } : loadPersistedState()));

  useEffect(() => {
    onChange?.(state.resumeData);
    if (!persist) return;
    try {
      window.localStorage.setItem('resume-studio-resume-data', JSON.stringify(state.resumeData));
    } catch {
      // Large original PDFs or a browser storage quota should never break editing.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.resumeData, persist]);

  const updatePersonalInfo = (data: Partial<ResumeData['personalInfo']>) => {
    dispatch({ type: 'UPDATE_PERSONAL_INFO', payload: data });
  };

  const updateSummary = (summary: string) => {
    dispatch({ type: 'UPDATE_SUMMARY', payload: summary });
  };

  const updateExperience = (experience: ResumeData['experience']) => {
    dispatch({ type: 'UPDATE_EXPERIENCE', payload: experience });
  };

  const updateEducation = (education: ResumeData['education']) => {
    dispatch({ type: 'UPDATE_EDUCATION', payload: education });
  };

  const updateProjects = (projects: ResumeData['projects']) => {
    dispatch({ type: 'UPDATE_PROJECTS', payload: projects });
  };

  const updateSkills = (skills: ResumeData['skills']) => {
    dispatch({ type: 'UPDATE_SKILLS', payload: skills });
  };

  const updateCustomSections = (sections: ResumeData['customSections']) => {
    dispatch({ type: 'UPDATE_CUSTOM_SECTIONS', payload: sections });
  };

  const updateSections = (sections: ResumeData['sections']) => {
    dispatch({ type: 'UPDATE_SECTIONS', payload: sections });
  };

  const updateColors = (colors: ResumeData['colors']) => {
    dispatch({ type: 'UPDATE_COLORS', payload: colors });
  };

  const updateTemplate = (template: ResumeData['template']) => {
    dispatch({ type: 'UPDATE_TEMPLATE', payload: template });
  };

  const updatePageFormat = (format: ResumeData['pageFormat']) => {
    dispatch({ type: 'UPDATE_PAGE_FORMAT', payload: format });
  };

  const updateFontSize = (fontSize: ResumeData['fontSize']) => {
    dispatch({ type: 'UPDATE_FONT_SIZE', payload: fontSize });
  };

  const updateFontFamily = (fontFamily: ResumeData['fontFamily']) => {
    dispatch({ type: 'UPDATE_FONT_FAMILY', payload: fontFamily });
  };

  const setEditing = (editing: boolean) => {
    dispatch({ type: 'SET_EDITING', payload: editing });
  };

  const setSelectedSection = (section: string | null) => {
    dispatch({ type: 'SET_SELECTED_SECTION', payload: section });
  };

  const resetResume = () => {
    dispatch({ type: 'RESET_RESUME' });
  };

  const importResumeData = (data: ResumeData) => {
    dispatch({ type: 'IMPORT_RESUME_DATA', payload: data });
  };

  const exportResumeData = (): ResumeData => {
    return state.resumeData;
  };

  const value: ResumeContextType = {
    state,
    dispatch,
    updatePersonalInfo,
    updateSummary,
    updateExperience,
    updateEducation,
    updateProjects,
    updateSkills,
    updateCustomSections,
    updateSections,
    updateColors,
    updateTemplate,
    updatePageFormat,
    updateFontSize,
    updateFontFamily,
    setEditing,
    setSelectedSection,
    resetResume,
    importResumeData,
    exportResumeData
  };

  return (
    <ResumeContext.Provider value={value}>
      {children}
    </ResumeContext.Provider>
  );
};

export const useResume = () => {
  const context = useContext(ResumeContext);
  if (context === undefined) {
    throw new Error('useResume must be used within a ResumeProvider');
  }
  return context;
};