//! Native attempt authority. Protected by the opening mutex, never supplied by a model.
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity { pub generation: u64, pub revision: u64, pub attempt: u64 }
#[derive(Default)]
pub struct Authority { revision: u64, next: u64, active: Option<Identity>, accepted: bool }
impl Authority {
    pub const fn new() -> Self { Self { revision: 0, next: 0, active: None, accepted: false } }
    pub fn has_started(&self) -> bool { self.next > 0 }
    pub fn invalidate(&mut self, revision: u64) -> Result<(), String> {
        if revision < self.revision { return Err("translator_obsolete".into()); }
        if revision > self.revision { self.revision = revision; self.active = None; self.accepted = false; }
        Ok(())
    }
    pub fn begin(&mut self, generation: u64, revision: u64) -> Result<Identity, String> {
        self.invalidate(revision)?;
        if self.active.is_some() && !self.accepted { return Err("translator_busy".into()); }
        self.next += 1;
        let id = Identity { generation, revision, attempt: self.next };
        self.active = Some(id); self.accepted = false;
        Ok(id)
    }
    pub fn validate(&self, id: Identity) -> Result<(), String> {
        if self.active == Some(id) && !self.accepted { Ok(()) } else { Err("translator_obsolete".into()) }
    }
    pub fn accept(&mut self, id: Identity) -> Result<(), String> {
        self.validate(id)?; self.accepted = true; Ok(())
    }
}
/// Latest accepted text result; attempt identity remains native-owned.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedTranslation {
    pub identity: Identity,
    pub translated: String,
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalidation_during_debounce_and_duplicate_acceptance() {
        let mut a = Authority::default();
        let old = a.begin(7, 1).unwrap();
        assert!(a.begin(7, 1).is_err());
        a.invalidate(2).unwrap();
        assert!(a.accept(old).is_err());
        assert!(a.invalidate(1).is_err());
        let new = a.begin(7, 2).unwrap();
        a.accept(new).unwrap();
        assert!(a.accept(new).is_err());
        let retry = a.begin(7, 2).unwrap();
        assert_ne!(retry.attempt, new.attempt);
        assert!(a.validate(new).is_err());
        assert!(a.validate(retry).is_ok());
    }
}

#[cfg(test)]
mod race_tests {
    use super::*;
    #[tokio::test]
    async fn native_inflight_completion_cannot_accept_after_setter_invalidation() {
        let authority = std::sync::Arc::new(std::sync::Mutex::new(Authority::new()));
        let old = authority.lock().unwrap().begin(4, 1).unwrap();
        let (send, receive) = tokio::sync::oneshot::channel();
        let worker = authority.clone();
        let request = tokio::spawn(async move {
            receive.await.unwrap();
            let mut boundary = worker.lock().unwrap();
            boundary.accept(old)
        });
        authority.lock().unwrap().invalidate(2).unwrap();
        send.send(()).unwrap();
        assert!(request.await.unwrap().is_err());
        let id = authority.lock().unwrap().begin(4, 2).unwrap();
        authority.lock().unwrap().accept(id).unwrap();
        assert!(authority.lock().unwrap().accept(id).is_err());
    }
}
