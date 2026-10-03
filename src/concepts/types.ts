export interface Reference {
  title: string;
  url: string;
}

export interface Concept {
  id: string;
  title: string;
  category: string;
  /** The concrete way this bites a system that doesn't have it. */
  failureScenario: string;
  /** The mechanism that prevents it. */
  fix: string;
  /**
   * When to actually reach for this - and, as importantly, when not to.
   * Optional because plenty of concepts have no real "should I?" decision
   * (you don't choose whether to have secrets management). Only write one
   * where a genuine tradeoff exists, or it turns into filler.
   */
  whenToUse?: string;
  /** Further reading. Kept short on purpose - three good links beat a bibliography. */
  references?: Reference[];
  /**
   * A few lines of code showing the failure and the fix side by side. A beginner
   * can't turn "use exponential backoff" into code; a snippet they can copy can.
   */
  example?: string;
  /**
   * The graded lesson that practises this, as the exact command to run. A test
   * checks every one resolves to a real unit, so this can never point nowhere.
   */
  practice?: string;
}
