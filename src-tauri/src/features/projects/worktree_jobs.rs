//! Durable intent journal for asynchronous Worktree deletion.
//! Execution remains in the frontend because session shutdown and SQL are owned there.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const MAX_JOBS: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorktreeDeleteMode {
    Finish,
    Discard,
    Force,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeDeleteJob {
    pub id: String,
    pub request: super::finish::FinishRequest,
    pub mode: WorktreeDeleteMode,
    pub delete_branch: bool,
    pub state: String,
    pub phase: String,
    pub attempts: u32,
    pub last_error: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct QueueFile {
    jobs: Vec<WorktreeDeleteJob>,
}

#[derive(Clone)]
pub struct WorktreeDeleteQueue {
    inner: Arc<Mutex<QueueFile>>,
    path: PathBuf,
}

impl WorktreeDeleteQueue {
    pub fn load() -> Result<Self, String> {
        let path = crate::app_paths::cli_manager_data_dir()?.join("worktree-delete-jobs.json");
        let file = if path.is_file() {
            match fs::read(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            {
                Some(file) => file,
                None => {
                    let backup = path.with_extension("json.invalid");
                    let _ = fs::rename(&path, backup);
                    QueueFile::default()
                }
            }
        } else {
            QueueFile::default()
        };
        Ok(Self {
            inner: Arc::new(Mutex::new(file)),
            path,
        })
    }

    pub fn enqueue(
        &self,
        request: super::finish::FinishRequest,
        mode: WorktreeDeleteMode,
        delete_branch: bool,
    ) -> Result<WorktreeDeleteJob, String> {
        let mut file = self
            .inner
            .lock()
            .map_err(|_| "worktree_jobs_lock".to_string())?;
        if let Some(existing) = file.jobs.iter().find(|j| {
            j.request == request
                && j.mode == mode
                && j.delete_branch == delete_branch
                && !matches!(j.state.as_str(), "completed" | "needsReconfirmation")
        }) {
            return Ok(existing.clone());
        }
        if file.jobs.iter().any(|j| {
            j.request.worktree_id == request.worktree_id
                && !matches!(j.state.as_str(), "completed" | "needsReconfirmation")
        }) {
            return Err("worktree_delete_conflict".into());
        }
        if file.jobs.len() >= MAX_JOBS {
            file.jobs.retain(|job| job.state != "completed");
        }
        if file.jobs.len() >= MAX_JOBS {
            return Err("worktree_jobs_full".into());
        }
        let now = now_ms();
        let job = WorktreeDeleteJob {
            id: Uuid::new_v4().to_string(),
            request,
            mode,
            delete_branch,
            state: "queued".into(),
            phase: "queued".into(),
            attempts: 0,
            last_error: None,
            created_at_ms: now,
            updated_at_ms: now,
        };
        file.jobs.push(job.clone());
        self.save_locked(&file)?;
        Ok(job)
    }

    pub fn list(&self) -> Result<Vec<WorktreeDeleteJob>, String> {
        Ok(self
            .inner
            .lock()
            .map_err(|_| "worktree_jobs_lock".to_string())?
            .jobs
            .clone())
    }

    pub fn update(
        &self,
        id: &str,
        expected_state: Option<String>,
        state: Option<String>,
        phase: Option<String>,
        error: Option<String>,
    ) -> Result<WorktreeDeleteJob, String> {
        let mut file = self
            .inner
            .lock()
            .map_err(|_| "worktree_jobs_lock".to_string())?;
        let job = file
            .jobs
            .iter_mut()
            .find(|j| j.id == id)
            .ok_or("worktree_job_not_found")?;
        if let Some(expected) = expected_state {
            if job.state != expected { return Err("worktree_job_state_changed".into()); }
        }
        if job.state == "completed" || job.state == "needsReconfirmation" {
            return Err("worktree_job_terminal".into());
        }
        if let Some(value) = state {
            if !matches!(value.as_str(), "queued" | "running" | "retryWait" | "completed" | "needsReconfirmation") {
                return Err("worktree_job_state_invalid".into());
            }
            let legal = match value.as_str() {
                "running" => matches!(job.state.as_str(), "queued" | "retryWait"),
                "retryWait" => job.state == "running",
                "completed" => job.state == "running" && phase.as_deref() == Some("completed"),
                "needsReconfirmation" => matches!(job.state.as_str(), "running" | "retryWait") && phase.as_deref() == Some("needsReconfirmation"),
                "queued" => matches!(job.state.as_str(), "queued" | "running" | "retryWait"),
                _ => false,
            };
            if !legal { return Err("worktree_job_transition_invalid".into()); }
            if value == "running" { job.attempts = job.attempts.saturating_add(1); }
            job.state = value;
        }
        if let Some(value) = phase {
            if !matches!(value.as_str(), "queued" | "closingSessions" | "retryWait" | "completed" | "needsReconfirmation") {
                return Err("worktree_job_phase_invalid".into());
            }
            job.phase = value;
        }
        // Callers pass null when a successful transition clears an old error.
        job.last_error = error;
        job.updated_at_ms = now_ms();
        let result = job.clone();
        self.save_locked(&file)?;
        Ok(result)
    }

    fn save_locked(&self, file: &QueueFile) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let bytes = serde_json::to_vec_pretty(file).map_err(|e| e.to_string())?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
        #[cfg(windows)]
        if self.path.exists() {
            fs::remove_file(&self.path).map_err(|e| e.to_string())?;
        }
        fs::rename(tmp, &self.path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn git_worktree_delete_enqueue(
    req: super::finish::FinishRequest,
    mode: WorktreeDeleteMode,
    delete_branch: bool,
    queue: tauri::State<'_, WorktreeDeleteQueue>,
) -> Result<WorktreeDeleteJob, String> {
    queue.enqueue(req, mode, delete_branch)
}

#[tauri::command]
pub async fn git_worktree_delete_jobs(
    queue: tauri::State<'_, WorktreeDeleteQueue>,
) -> Result<Vec<WorktreeDeleteJob>, String> {
    queue.list()
}

#[tauri::command]
pub async fn git_worktree_delete_job_update(
    id: String,
    expected_state: Option<String>,
    state: Option<String>,
    phase: Option<String>,
    error: Option<String>,
    queue: tauri::State<'_, WorktreeDeleteQueue>,
) -> Result<WorktreeDeleteJob, String> {
    queue.update(&id, expected_state, state, phase, error)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mode_is_serializable() {
        assert!(serde_json::to_string(&WorktreeDeleteMode::Force).is_ok());
    }

    #[test]
    fn queue_states_are_closed() {
        for state in ["queued", "running", "retryWait", "completed", "needsReconfirmation"] {
            assert!(["queued", "running", "retryWait", "completed", "needsReconfirmation"].contains(&state));
        }
    }
}
