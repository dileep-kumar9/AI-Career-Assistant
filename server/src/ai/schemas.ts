import { z } from 'zod';

/** Tiny JSON-Schema builders producing strict schemas (all keys required, no extras). */
export const S = {
  str: (description?: string) => ({ type: 'string', ...(description ? { description } : {}) }),
  num: (description?: string) => ({ type: 'number', ...(description ? { description } : {}) }),
  bool: () => ({ type: 'boolean' }),
  arr: (items: object, description?: string) => ({ type: 'array', items, ...(description ? { description } : {}) }),
  obj: (properties: Record<string, object>, description?: string) => ({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
    ...(description ? { description } : {}),
  }),
  nullable: (schema: object) => ({ anyOf: [schema, { type: 'null' }] }),
  enumOf: (values: string[]) => ({ type: 'string', enum: values }),
};

const strArr = S.arr(S.str());

// ---------------------------------------------------------------- parse
export const PARSE_SCHEMA = S.obj({
  personalInfo: S.obj({ fullName: S.str(), headline: S.str('Professional job title shown under the name, e.g. "Software Engineer". Empty if absent or if that line is only a degree, education or status such as "Fresher"'), email: S.str(), phone: S.str(), location: S.str(), linkedin: S.str(), website: S.str(), github: S.str() }),
  summary: S.str(),
  skills: S.arr(S.obj({ category: S.str('Category name as written, or "Skills" if uncategorised'), skills: strArr })),
  experience: S.arr(
    S.obj({ jobTitle: S.str(), company: S.str(), location: S.str(), startDate: S.str('YYYY-MM, YYYY, or empty'), endDate: S.str('YYYY-MM, YYYY, or empty'), current: S.bool(), description: S.str(), bullets: strArr }),
  ),
  projects: S.arr(S.obj({ title: S.str(), description: S.str(), technologies: strArr, url: S.str(), startDate: S.str(), endDate: S.str() })),
  education: S.arr(S.obj({ degree: S.str(), institution: S.str(), location: S.str(), graduationYear: S.str(), gpa: S.str(), honors: S.str() })),
  certifications: S.arr(S.obj({ name: S.str(), issuer: S.str(), date: S.str() })),
  achievements: strArr,
  additionalSections: S.arr(S.obj({ title: S.str(), content: S.str() })),
});

const zs = z.string().catch('');
const zsa = z.array(z.string()).catch([]);
export const ParseOutput = z.object({
  personalInfo: z.object({ fullName: zs, headline: zs, email: zs, phone: zs, location: zs, linkedin: zs, website: zs, github: zs }).partial().catch({}),
  summary: zs,
  skills: z.array(z.object({ category: zs, skills: zsa })).catch([]),
  experience: z.array(z.object({ jobTitle: zs, company: zs, location: zs, startDate: zs, endDate: zs, current: z.boolean().catch(false), description: zs, bullets: zsa })).catch([]),
  projects: z.array(z.object({ title: zs, description: zs, technologies: zsa, url: zs, startDate: zs, endDate: zs })).catch([]),
  education: z.array(z.object({ degree: zs, institution: zs, location: zs, graduationYear: zs, gpa: zs, honors: zs })).catch([]),
  certifications: z.array(z.object({ name: zs, issuer: zs, date: zs })).catch([]),
  achievements: zsa,
  additionalSections: z.array(z.object({ title: zs, content: zs })).catch([]),
});
export type ParseOutput = z.infer<typeof ParseOutput>;

// ---------------------------------------------------------------- job description
export const JD_SCHEMA = S.obj({
  jobTitle: S.str(),
  company: S.str('Empty if not stated'),
  requiredSkills: S.arr(S.str(), 'Skills/technologies the JD states as required, using the JD wording'),
  preferredSkills: S.arr(S.str(), 'Nice-to-have skills, using the JD wording'),
  tools: strArr,
  experienceRequirements: strArr,
  educationRequirements: strArr,
  certifications: strArr,
  responsibilities: strArr,
  industryKeywords: strArr,
  atsKeywords: S.arr(S.str(), 'The most important exact terms an ATS would search for, verbatim from the JD'),
});
export const JdOutput = z.object({
  jobTitle: zs,
  company: zs,
  requiredSkills: zsa,
  preferredSkills: zsa,
  tools: zsa,
  experienceRequirements: zsa,
  educationRequirements: zsa,
  certifications: zsa,
  responsibilities: zsa,
  industryKeywords: zsa,
  atsKeywords: zsa,
});
export type JdOutput = z.infer<typeof JdOutput>;

// ---------------------------------------------------------------- shared content-update pieces
const skillCats = S.arr(S.obj({ name: S.str(), skills: strArr }));
const expUpdate = S.arr(S.obj({ id: S.str('Existing experience id, or "new" only for a role the user described in this instruction'), jobTitle: S.str('Only used for "new"'), company: S.str('Only used for "new"'), location: S.str(), startDate: S.str(), endDate: S.str(), current: S.bool(), description: S.str(), bullets: strArr }));
const projUpdate = S.arr(S.obj({ id: S.str('Existing project id, or "new" only for a project the user described in this instruction'), title: S.str(), description: S.str(), technologies: strArr }));
const idList = S.arr(S.obj({ id: S.str() }));
const certUpdate = S.arr(S.obj({ id: S.str('Existing id or "new"'), name: S.str(), issuer: S.str(), date: S.str() }));
const achUpdate = S.arr(S.obj({ id: S.str('Existing id or "new"'), text: S.str() }));
const sectionUpdate = S.arr(S.obj({ id: S.enumOf(['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements', 'custom']), visible: S.bool(), title: S.str('Standard ATS heading') }));
const customUpdate = S.arr(S.obj({ id: S.str('Existing id or "new"'), title: S.str(), content: S.str() }));

// ---------------------------------------------------------------- generate
export const GENERATE_SCHEMA = S.obj({
  headline: S.str('Target-role headline under the name; must be truthful'),
  summary: S.str(),
  skills: skillCats,
  experience: S.arr(S.obj({ id: S.str(), description: S.str(), bullets: strArr })),
  projects: S.arr(S.obj({ id: S.str(), description: S.str() })),
  achievements: S.arr(S.obj({ id: S.str(), text: S.str() })),
  sectionOrder: S.arr(S.enumOf(['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements', 'custom'])),
  skillGaps: S.arr(S.str(), 'JD requirements with no evidence in the resume'),
  notes: strArr,
});
const idText = z.object({ id: zs, text: zs });
export const GenerateOutput = z.object({
  headline: zs,
  summary: zs,
  skills: z.array(z.object({ name: zs, skills: zsa })).catch([]),
  experience: z.array(z.object({ id: zs, description: zs, bullets: zsa })).catch([]),
  projects: z.array(z.object({ id: zs, description: zs })).catch([]),
  achievements: z.array(idText).catch([]),
  sectionOrder: zsa,
  skillGaps: zsa,
  notes: zsa,
});
export type GenerateOutput = z.infer<typeof GenerateOutput>;

// ---------------------------------------------------------------- edit
export const EDIT_SCHEMA = S.obj({
  message: S.str('Reply to the user: a thorough answer for analysis/questions/advice, or 1-3 sentences describing the changes made'),
  changes: S.arr(S.str(), 'Concrete changes actually made'),
  clarifyingQuestion: S.str('Non-empty only when essential facts are missing; never ask the user to upload their resume'),
  skillGaps: strArr,
  offer: S.obj(
    { skills: S.arr(S.str()), projects: S.arr(S.obj({ title: S.str(), description: S.str('One or two sentences'), technologies: strArr })) },
    'Items you are OFFERING to add and asking the user to confirm (JD skills they may have, suggested projects). Empty lists otherwise.',
  ),
  updates: S.obj(
    {
      headline: S.nullable(S.str()),
      summary: S.nullable(S.str()),
      skills: S.nullable(skillCats),
      experience: S.nullable(expUpdate),
      projects: S.nullable(projUpdate),
      education: S.nullable(idList),
      certifications: S.nullable(certUpdate),
      achievements: S.nullable(achUpdate),
      sections: S.nullable(sectionUpdate),
      customSections: S.nullable(customUpdate),
      template: S.nullable(S.enumOf(['professional', 'ats-classic', 'modern-professional', 'technical', 'minimal'])),
      layout: S.nullable(S.obj({ margins: S.enumOf(['narrow', 'normal', 'wide']), pageTarget: S.enumOf(['1', '2']), fontSize: S.enumOf(['small', 'medium', 'large']) })),
      style: S.nullable(
        S.obj(
          {
            reset: S.bool(),
            fontFamily: S.nullable(S.str()),
            nameSize: S.nullable(S.num()),
            headlineSize: S.nullable(S.num()),
            headingSize: S.nullable(S.num()),
            bodySize: S.nullable(S.num()),
            contactSize: S.nullable(S.num()),
            nameColor: S.nullable(S.str()),
            headlineColor: S.nullable(S.str()),
            headingColor: S.nullable(S.str()),
            textColor: S.nullable(S.str()),
            contactColor: S.nullable(S.str()),
            headingUppercase: S.nullable(S.bool()),
            headingRule: S.nullable(S.bool()),
            headlineBold: S.nullable(S.bool()),
            nameAlign: S.nullable(S.enumOf(['left', 'center'])),
            justify: S.nullable(S.bool()),
            lineHeight: S.nullable(S.num()),
          },
          'Typography and colour changes. Sizes in points, colours as #rrggbb, null = unchanged. reset=true restores the template defaults.',
        ),
      ),
    },
    'Use null for every section you are NOT changing. For a changed list, return the complete list in the desired order; omitted ids are removed.',
  ),
});
const nul = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional().catch(null);
export const EditOutput = z.object({
  message: zs,
  changes: zsa,
  clarifyingQuestion: zs,
  skillGaps: zsa,
  offer: z.object({ skills: zsa, projects: z.array(z.object({ title: zs, description: zs, technologies: zsa })).catch([]) }).catch({ skills: [], projects: [] }),
  updates: z
    .object({
      headline: nul(z.string()),
      summary: nul(z.string()),
      skills: nul(z.array(z.object({ name: zs, skills: zsa }))),
      experience: nul(z.array(z.object({ id: zs, jobTitle: zs, company: zs, location: zs, startDate: zs, endDate: zs, current: z.boolean().catch(false), description: zs, bullets: zsa }))),
      projects: nul(z.array(z.object({ id: zs, title: zs, description: zs, technologies: zsa }))),
      education: nul(z.array(z.object({ id: zs }))),
      certifications: nul(z.array(z.object({ id: zs, name: zs, issuer: zs, date: zs }))),
      achievements: nul(z.array(idText)),
      sections: nul(z.array(z.object({ id: zs, visible: z.boolean().catch(true), title: zs }))),
      customSections: nul(z.array(z.object({ id: zs, title: zs, content: zs }))),
      template: nul(z.enum(['professional', 'ats-classic', 'modern-professional', 'technical', 'minimal'])),
      layout: nul(z.object({ margins: z.enum(['narrow', 'normal', 'wide']).catch('normal'), pageTarget: z.union([z.literal('1'), z.literal('2'), z.literal(1), z.literal(2)]).catch('1'), fontSize: z.enum(['small', 'medium', 'large']).catch('medium') })),
      style: nul(z.object({ reset: z.boolean().catch(false), fontFamily: z.string().nullable().catch(null), nameSize: z.number().nullable().catch(null), headlineSize: z.number().nullable().catch(null), headingSize: z.number().nullable().catch(null), bodySize: z.number().nullable().catch(null), contactSize: z.number().nullable().catch(null), nameColor: z.string().nullable().catch(null), headlineColor: z.string().nullable().catch(null), headingColor: z.string().nullable().catch(null), textColor: z.string().nullable().catch(null), contactColor: z.string().nullable().catch(null), headingUppercase: z.boolean().nullable().catch(null), headingRule: z.boolean().nullable().catch(null), headlineBold: z.boolean().nullable().catch(null), nameAlign: z.enum(['left', 'center']).nullable().catch(null), justify: z.boolean().nullable().catch(null), lineHeight: z.number().nullable().catch(null) })),
    })
    .catch({}),
});
export type EditOutput = z.infer<typeof EditOutput>;

// ---------------------------------------------------------------- semantic relevance
export const SEMANTIC_SCHEMA = S.obj({ score: S.num('0-100: how relevant the candidate’s demonstrated experience is to the role'), rationale: S.str('One or two sentences') });
export const SemanticOutput = z.object({ score: z.coerce.number().min(0).max(100), rationale: zs });

/** Throws when the parsed value does not satisfy the zod schema. */
export function validator<S extends z.ZodTypeAny>(schema: S) {
  return (raw: unknown): z.infer<S> => {
    const result = schema.safeParse(raw);
    if (!result.success) throw new Error(`AI response failed schema validation: ${result.error.issues[0]?.message || 'invalid'}`);
    return result.data;
  };
}

// ---------------------------------------------------------------- add entry from a brief / file
export const ENTRY_SCHEMA = S.obj({
  kind: S.enumOf(['project', 'experience', 'certification', 'unclear']),
  project: S.obj({ title: S.str('Project name from the source, or a short descriptive name'), technologies: strArr, points: S.arr(S.str(), 'One fact per point, action verb first'), githubUrl: S.str(), liveUrl: S.str(), startDate: S.str('YYYY-MM or empty'), endDate: S.str('YYYY-MM, "Present" or empty') }),
  experience: S.obj({ jobTitle: S.str(), company: S.str(), location: S.str(), startDate: S.str('YYYY-MM or empty'), endDate: S.str('YYYY-MM or empty'), current: S.bool(), points: S.arr(S.str(), 'One fact per point, action verb first') }),
  certification: S.obj({ name: S.str(), issuer: S.str(), date: S.str('YYYY-MM or empty') }),
  skillsUsed: S.arr(S.str(), 'Tools/technologies/skills the source says were used'),
  question: S.str('Only if an essential fact is missing (e.g. company name of an internship); otherwise empty'),
});
export const EntryOutput = z.object({
  kind: z.enum(['project', 'experience', 'certification', 'unclear']).catch('unclear'),
  project: z.object({ title: zs, technologies: zsa, points: zsa, githubUrl: zs, liveUrl: zs, startDate: zs, endDate: zs }).catch({ title: '', technologies: [], points: [], githubUrl: '', liveUrl: '', startDate: '', endDate: '' }),
  experience: z.object({ jobTitle: zs, company: zs, location: zs, startDate: zs, endDate: zs, current: z.boolean().catch(false), points: zsa }).catch({ jobTitle: '', company: '', location: '', startDate: '', endDate: '', current: false, points: [] }),
  certification: z.object({ name: zs, issuer: zs, date: zs }).catch({ name: '', issuer: '', date: '' }),
  skillsUsed: zsa,
  question: zs,
});
export type EntryOutput = z.infer<typeof EntryOutput>;
