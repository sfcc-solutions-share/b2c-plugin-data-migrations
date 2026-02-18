/**
 * Minimal type declaration for the optional inquirer dependency.
 * inquirer is only used for interactive feature selection prompts.
 */
declare module 'inquirer' {
  interface Question {
    name: string;
    message: string;
    type: string;
    choices?: string[];
    [key: string]: unknown;
  }

  interface Answers {
    [key: string]: unknown;
  }

  interface PromptModule {
    prompt(questions: Question[], defaults?: Record<string, unknown>): Promise<Answers>;
  }

  const inquirer: PromptModule;
  export default inquirer;
}
