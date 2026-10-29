use super::*;
impl PtyManager {
    // Closing retains ownership until process tree, controller and reader are done.
    pub fn close_until(&self, session_id: &str, deadline: Instant) -> Result<(), String> {
        let session_arc = {
            let mut closing = self.closing.try_lock().map_err(|_| "pty_closing_busy")?;
            if let Some(session) = closing.get(session_id) { Some(session.clone()) }
            else {
                let mut active = self.sessions.try_write().map_err(|_| "pty_sessions_busy")?;
                // Do not remove ordinary Unix sessions when strict tree proof is unsupported.
                if let Some(session) = active.get(session_id) {
                    session.try_lock().map_err(|_| "pty_session_busy")?.child.tree_stopped()?;
                }
                let session = active.remove(session_id);
                if let Some(session) = &session { closing.insert(session_id.into(), session.clone()); }
                session
            }
        };
        let Some(session_arc) = session_arc else { return Ok(()); };
        let child = {
            let session = session_arc.try_lock().map_err(|_| "pty_session_busy")?;
            if let Some(error) = &session.close_error { return Err(error.clone()); }
            session.child.clone()
        };
        if !child.tree_stopped()? {
            if Instant::now() >= deadline { return Err("pty_tree_timeout".into()); }
            child.kill()?;
        }
        while !child.tree_stopped()? {
            if Instant::now() >= deadline { return Err("pty_tree_timeout".into()); }
            std::thread::sleep(Duration::from_millis(10));
        }
        {
            let mut session = session_arc.try_lock().map_err(|_| "pty_session_busy")?;
            if let Some(controller) = session.controller.take() {
                session.release_handle = Some(std::thread::spawn(move || drop(controller)));
            }
        }
        loop {
            {
                let mut session = session_arc.try_lock().map_err(|_| "pty_session_busy")?;
                if session.release_handle.as_ref().is_some_and(|h| h.is_finished()) {
                    if session.release_handle.take().unwrap().join().is_err() {
                        session.close_error = Some("pty_release_panicked".into());
                        return Err("pty_release_panicked".into());
                    }
                }
                if session.reader_handle.as_ref().is_some_and(|h| h.is_finished()) {
                    if session.reader_handle.take().unwrap().join().is_err() {
                        session.close_error = Some("pty_reader_panicked".into());
                        return Err("pty_reader_panicked".into());
                    }
                }
                if session.watcher_handle.as_ref().is_some_and(|h| h.is_finished()) {
                    if session.watcher_handle.take().unwrap().join().is_err() {
                        session.close_error = Some("pty_watcher_panicked".into());
                        return Err("pty_watcher_panicked".into());
                    }
                }
                if session.release_handle.is_none() && session.reader_handle.is_none() && session.watcher_handle.is_none() { break; }
            }
            if Instant::now() >= deadline { return Err("pty_release_timeout".into()); }
            std::thread::sleep(Duration::from_millis(10));
        }
        self.closing.try_lock().map_err(|_| "pty_closing_busy")?.remove(session_id);
        self.statuses.try_lock().map_err(|_| "pty_status_busy")?.remove(session_id);
        Ok(())
    }

}
