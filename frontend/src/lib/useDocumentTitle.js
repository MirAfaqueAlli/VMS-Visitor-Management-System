// frontend/src/lib/useDocumentTitle.js
// Browser tab title: "<Page> | OHPC VMS" (or the app's full name when there's no page).
import { useEffect } from 'react';

const APP = 'OHPC VMS';
const DEFAULT_TITLE = `${APP} | Visitor Management System`;

export default function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} | ${APP}` : DEFAULT_TITLE;
  }, [title]);
}
