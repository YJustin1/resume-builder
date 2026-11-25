// App shell: two views (SPEC §6), chosen by the URL hash so the browser's back
// button works without a router. Both views stay mounted, so an unsaved resume
// draft survives a visit to the library.

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type LibraryData } from './api.ts';
import { LibraryView } from './LibraryView.tsx';
import { ResumesView } from './ResumesView.tsx';
import { ProblemBox, problemOf, PromptProvider, type Problem } from './ui.tsx';

type View = 'library' | 'resumes';
const viewFromHash = (): View => (location.hash === '#/resumes' ? 'resumes' : 'library');

export function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const [library, setLibrary] = useState<LibraryData | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [dirty, setDirty] = useState(false);
  // Bumped on every library refresh, so views can drop output that predates a shared edit.
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    // `npm run dev` answers 503 API_STARTING until the API is up: keep trying
    // for a while instead of leaving an opened page stuck (review round 3, 13).
    for (let attempt = 0; ; attempt++) {
      try {
        setLibrary(await api.library());
        setVersion((v) => v + 1);
        setProblem(null);
        return;
      } catch (error) {
        if (error instanceof ApiError && error.code === 'API_STARTING' && attempt < 60) {
          setProblem({ message: 'The local API server is starting…' });
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        setProblem(problemOf(error));
        return;
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onHash = () => setView(viewFromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, [refresh]);

  // Closing or reloading the tab with an unsaved resume asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);

  return (
    <PromptProvider>
      <header className="top">
        <h1>Resume Builder</h1>
        <nav aria-label="Main">
          <a href="#/library" aria-current={view === 'library' ? 'page' : undefined}>
            Library
          </a>
          <a href="#/resumes" aria-current={view === 'resumes' ? 'page' : undefined}>
            Resumes{dirty ? ' (unsaved)' : ''}
          </a>
        </nav>
      </header>
      <main>
        <ProblemBox problem={problem} />
        {!library ? (
          !problem && <p>Loading…</p>
        ) : (
          <>
            <div hidden={view !== 'library'}>
              <LibraryView library={library} refresh={refresh} />
            </div>
            <div hidden={view !== 'resumes'}>
              <ResumesView library={library} libraryVersion={version} active={view === 'resumes'} refresh={refresh} onDirtyChange={setDirty} />
            </div>
          </>
        )}
      </main>
    </PromptProvider>
  );
}
