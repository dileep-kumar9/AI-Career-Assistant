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

/** Editor state for the Resume Builder manual editor; `initialData` seeds it. Nothing is persisted in the browser. */
export const ResumeProvider: React.FC<{ children: ReactNode; initialData?: ResumeData; onChange?: (data: ResumeData) => void }> = ({ children, initialData, onChange }) => {
  const [state, dispatch] = useReducer(resumeReducer, initialState, (init) => (initialData ? { ...init, resumeData: initialData } : init));

  useEffect(() => {
    onChange?.(state.resumeData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.resumeData]);

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