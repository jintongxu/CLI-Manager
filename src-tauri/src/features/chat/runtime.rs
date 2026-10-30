use super::{
    repository::Repository,
    stream::{self, Part},
    types::*,
};
use crate::provider::chat_runtime;
use std::{
    collections::HashMap,
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};
use tauri::ipc::Channel;
use tokio::sync::{mpsc, watch, Mutex, Notify};
struct Active {
    conversation: String,
    cancel: watch::Sender<bool>,
}
struct Unsaved {
    message: Message,
    event: Event,
}
struct State {
    fenced: bool,
    active: HashMap<String, Active>,
    seen: HashMap<String, (String, Instant)>,
    unsaved: HashMap<String, Unsaved>,
}
pub(crate) struct Runtime {
    pub(super) owner: String,
    state: Mutex<State>,
    changed: Notify,
}
static RUNTIME: OnceLock<Arc<Runtime>> = OnceLock::new();
pub(crate) fn shared() -> Arc<Runtime> {
    RUNTIME
        .get_or_init(|| {
            Arc::new(Runtime {
                owner: uuid::Uuid::new_v4().to_string(),
                state: Mutex::new(State {
                    fenced: false,
                    active: HashMap::new(),
                    seen: HashMap::new(),
                    unsaved: HashMap::new(),
                }),
                changed: Notify::new(),
            })
        })
        .clone()
}
impl Runtime {
    async fn reserve(&self, i: &GenerateInput) -> Result<watch::Receiver<bool>> {
        uuid(&i.conversation_id)?;
        uuid(&i.request_id)?;
        let mut s = self.state.lock().await;
        s.seen
            .retain(|_, (_, at)| at.elapsed() < Duration::from_secs(600));
        if s.fenced {
            return Err("chat_shutting_down".into());
        }
        if s.seen.contains_key(&i.request_id) {
            return Err("chat_cancelled_or_replayed".into());
        }
        if s.active.len() >= 4 {
            return Err("chat_capacity".into());
        }
        if s.active
            .values()
            .any(|a| a.conversation == i.conversation_id)
            || s.unsaved
                .values()
                .any(|u| u.message.conversation_id == i.conversation_id)
        {
            return Err("chat_busy".into());
        }
        if s.seen.len() >= 4096 {
            return Err("chat_capacity".into());
        }
        let (cancel, rx) = watch::channel(false);
        s.seen.insert(
            i.request_id.clone(),
            (i.conversation_id.clone(), Instant::now()),
        );
        s.active.insert(
            i.request_id.clone(),
            Active {
                conversation: i.conversation_id.clone(),
                cancel,
            },
        );
        Ok(rx)
    }
    pub async fn cancel(&self, i: CancelInput) -> Result<()> {
        uuid(&i.conversation_id)?;
        uuid(&i.request_id)?;
        let mut s = self.state.lock().await;
        if let Some((conversation, _)) = s.seen.get(&i.request_id) {
            if conversation != &i.conversation_id {
                return Err(invalid());
            }
        }
        if let Some(a) = s.active.get(&i.request_id) {
            if a.conversation != i.conversation_id {
                return Err(invalid());
            }
            a.cancel.send_replace(true);
        } else {
            s.seen
                .retain(|_, (_, at)| at.elapsed() < Duration::from_secs(600));
            if s.seen.len() >= 4096 {
                return Err("chat_capacity".into());
            }
            s.seen
                .insert(i.request_id, (i.conversation_id, Instant::now()));
        }
        Ok(())
    }
    async fn release(&self, id: &str) {
        self.state.lock().await.active.remove(id);
        self.changed.notify_waiters();
    }
    pub async fn generate(
        self: Arc<Self>,
        repo: Repository,
        i: GenerateInput,
        channel: Channel<Event>,
    ) -> Result<Message> {
        let cancel = self.reserve(&i).await?;
        let setup = async {
            let resolved = chat_runtime::resolve(&i.app_type, &i.provider_id).await?;
            let client = chat_runtime::client().await?;
            if *cancel.borrow() {
                return Err("chat_cancelled".into());
            }
            repo.recover().await?;
            let (answer, history) = repo.begin(&i, &self.owner).await?;
            Ok::<_, String>((resolved, client, answer, history))
        }
        .await;
        let (resolved, client, answer, history) = match setup {
            Ok(v) => v,
            Err(e) => {
                self.release(&i.request_id).await;
                return Err(e);
            }
        };
        let receipt = answer.clone();
        tokio::spawn(async move {
            self.drive(
                repo, answer, history, resolved, client, i.model, cancel, channel,
            )
            .await;
            self.release(&i.request_id).await;
        });
        Ok(receipt)
    }
    async fn drive(
        &self,
        repo: Repository,
        message: Message,
        history: Vec<Message>,
        resolved: chat_runtime::Runtime,
        client: reqwest::Client,
        model: String,
        mut cancel: watch::Receiver<bool>,
        channel: Channel<Event>,
    ) {
        let (tx, mut rx) = mpsc::channel(8);
        let network = tokio::spawn(stream::run(
            client,
            resolved,
            model,
            history,
            cancel.clone(),
            tx,
        ));
        let mut event = Event {
            conversation_id: message.conversation_id.clone(),
            message_id: message.id.clone(),
            request_id: message.request_id.clone(),
            sequence: 0,
            content: String::new(),
            status: "pending".into(),
            error_code: None,
            finish_reason: None,
            saved: true,
        };
        let mut interval = tokio::time::interval(Duration::from_millis(500));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut dirty = false;
        let mut last_save = Instant::now();
        let mut done = false;
        loop {
            tokio::select! {
             biased;
             _=async {if *cancel.borrow() {return} let _=cancel.changed().await;}=> {
              event.status="stopped".into();event.error_code=None;break
             },
             _=interval.tick()=> {
              if dirty || last_save.elapsed()>=Duration::from_secs(5) {
               if repo.checkpoint(&message,&self.owner,&event.content,"pending",None,None).await.is_err() {
                event.status="failed".into();event.error_code=Some("chat_storage".into());event.saved=false;break
               }
               dirty=false;last_save=Instant::now();event.saved=true;
               event.sequence+=1;let _=channel.send(event.clone());
              }
             },
             part=rx.recv()=>match part {
              Some(Ok(Part::Text(text)))=> {
               if done {event.status="failed".into();event.error_code=Some("chat_protocol".into());break}
               event.content.push_str(&text);dirty=true;event.saved=false;
               event.sequence+=1;let _=channel.send(event.clone());
              },
              Some(Ok(Part::Done(reason)))=> {done=true;event.finish_reason=Some(reason)},
              Some(Err(error))=> {
               event.status=if error=="chat_cancelled" {"stopped"} else {"failed"}.into();
               event.error_code=if error=="chat_cancelled" {None} else {Some(error)};break
              },
              None=> {
               if done && !event.content.is_empty() {event.status="completed".into();}
               else {event.status="failed".into();event.error_code=Some(if done {"chat_empty"} else {"chat_protocol_eof"}.into());}break
              }
             }
            }
        }
        // Abort closes the response body even when a save failure races a blocked socket.
        network.abort();
        let _ = network.await;
        match repo
            .checkpoint(
                &message,
                &self.owner,
                &event.content,
                &event.status,
                event.error_code.as_deref(),
                event.finish_reason.as_deref(),
            )
            .await
        {
            Ok(()) => event.saved = true,
            Err(error) => {
                event.saved = false;
                event.error_code = Some(error.clone());
                if error == "chat_storage" {
                    self.state.lock().await.unsaved.insert(
                        message.request_id.clone(),
                        Unsaved {
                            message,
                            event: event.clone(),
                        },
                    );
                }
            }
        }
        event.sequence += 1;
        let _ = channel.send(event);
    }
    /// Called by the existing exit authority; never exits or starts another authority.
    pub async fn prepare(&self) {
        let mut s = self.state.lock().await;
        s.fenced = true;
        for a in s.active.values() {
            a.cancel.send_replace(true);
        }
    }
    pub async fn drain(&self, repo: Repository) -> Result<()> {
        tokio::time::timeout(Duration::from_secs(20), async {
            loop {
                if self.state.lock().await.active.is_empty() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .map_err(|_| "chat_drain_timeout".to_string())?;
        self.retry_unsaved(repo).await
    }
    pub async fn retry_unsaved(&self, repo: Repository) -> Result<()> {
        let mut s = self.state.lock().await;
        let ids: Vec<String> = s.unsaved.keys().cloned().collect();
        for id in ids {
            let u = &s.unsaved[&id];
            repo.retry_snapshot(
                &u.message,
                &self.owner,
                &u.event.content,
                &u.event.status,
                u.event.error_code.as_deref(),
                u.event.finish_reason.as_deref(),
            )
            .await?;
            s.unsaved.remove(&id);
        }
        Ok(())
    }
    pub async fn resume(&self) {
        self.state.lock().await.fenced = false;
    }
    pub async fn unsaved(&self) -> Vec<Event> {
        self.state
            .lock()
            .await
            .unsaved
            .values()
            .map(|u| u.event.clone())
            .collect()
    }
    pub async fn deleted(&self, id: &str) {
        let mut s = self.state.lock().await;
        for a in s.active.values().filter(|a| a.conversation == id) {
            a.cancel.send_replace(true);
        }
        s.unsaved.retain(|_, u| u.message.conversation_id != id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn instance() -> Arc<Runtime> {
        Arc::new(Runtime {
            owner: "test-owner".into(),
            state: Mutex::new(State {
                fenced: false,
                active: HashMap::new(),
                seen: HashMap::new(),
                unsaved: HashMap::new(),
            }),
            changed: Notify::new(),
        })
    }
    fn input() -> GenerateInput {
        GenerateInput {
            conversation_id: uuid::Uuid::new_v4().to_string(),
            revision: 0,
            request_id: uuid::Uuid::new_v4().to_string(),
            app_type: "claude".into(),
            provider_id: "mock".into(),
            model: "mock".into(),
            text: Some("test".into()),
            retry: false,
        }
    }
    #[tokio::test]
    async fn chat_runtime_cancel_tombstone_capacity_single_conversation_and_shutdown_fence() {
        let r = instance();
        let i = input();
        r.cancel(CancelInput {
            conversation_id: i.conversation_id.clone(),
            request_id: i.request_id.clone(),
        })
        .await
        .unwrap();
        assert!(r.reserve(&i).await.is_err());
        let i = input();
        let rx = r.reserve(&i).await.unwrap();
        let mut duplicate = i.clone();
        duplicate.request_id = uuid::Uuid::new_v4().to_string();
        assert_eq!(r.reserve(&duplicate).await.unwrap_err(), "chat_busy");
        for _ in 0..3 {
            r.reserve(&input()).await.unwrap();
        }
        assert_eq!(r.reserve(&input()).await.unwrap_err(), "chat_capacity");
        r.prepare().await;
        assert!(*rx.borrow());
        assert_eq!(r.reserve(&input()).await.unwrap_err(), "chat_shutting_down");
        let ids: Vec<String> = r.state.lock().await.active.keys().cloned().collect();
        for id in ids {
            r.release(&id).await;
        }
        r.resume().await;
        r.reserve(&input()).await.unwrap();
        assert!(r.reserve(&i).await.is_err());
    }
    #[tokio::test]
    async fn chat_exit_registry_drain_waits_for_cancelled_save_then_resume_never_replays() {
        use super::super::tests::{database, generation};
        let (_dir, repo) = database().await;
        let conversation = repo
            .create(CreateInput { title: None })
            .await
            .unwrap()
            .conversation;
        let input = generation(&conversation);
        let runtime = instance();
        let cancel = runtime.reserve(&input).await.unwrap();
        let (message, history) = repo.begin(&input, &runtime.owner).await.unwrap();
        // No provider network is launched: cancelled drive wins before the fake endpoint.
        runtime.prepare().await;
        assert!(*cancel.borrow());
        assert_eq!(
            runtime.reserve(&self::input()).await.unwrap_err(),
            "chat_shutting_down"
        );
        let draining = {
            let runtime = runtime.clone();
            let repo = repo.clone();
            tokio::spawn(async move { runtime.drain(repo).await })
        };
        tokio::task::yield_now().await;
        assert!(
            !draining.is_finished(),
            "registry entry must retain the drain barrier"
        );
        runtime
            .drive(
                repo.clone(),
                message,
                history,
                chat_runtime::Runtime {
                    protocol: chat_runtime::Protocol::Chat,
                    endpoint: "http://127.0.0.1:1".into(),
                    key: "synthetic".into(),
                    model: None,
                },
                reqwest::Client::new(),
                "mock".into(),
                cancel,
                Channel::new(|_| Ok(())),
            )
            .await;
        runtime.release(&input.request_id).await;
        draining.await.unwrap().unwrap();
        let detail = repo.get(&conversation.id).await.unwrap();
        assert_eq!(detail.messages[1].status, "stopped");
        assert!(detail.conversation.request_id.is_none());
        runtime.resume().await;
        assert!(runtime.state.lock().await.active.is_empty());
        assert!(
            runtime.reserve(&input).await.is_err(),
            "resume cannot replay the old request"
        );
        runtime.reserve(&self::input()).await.unwrap();
    }
    #[tokio::test]
    async fn chat_runtime_real_db_terminal_save_cancel_and_unsaved_retry() {
        use super::super::tests::{database, fixtures, generation, mock_server};
        for fail_save in [false, true] {
            let (_dir, repo) = database().await;
            let c = repo
                .create(CreateInput { title: None })
                .await
                .unwrap()
                .conversation;
            let i = generation(&c);
            let r = instance();
            let cancel = r.reserve(&i).await.unwrap();
            let (m, h) = repo.begin(&i, &r.owner).await.unwrap();
            if fail_save {
                sqlx::raw_sql("CREATE TRIGGER fail_save BEFORE UPDATE ON chat_messages BEGIN SELECT RAISE(ABORT,'injected'); END;")
                    .execute(&repo.pool).await.unwrap();
            }
            let (protocol, fixture) = fixtures().remove(1);
            let (base, server) = mock_server("200 OK", fixture.into_bytes(), false).await;
            let runtime = chat_runtime::Runtime {
                protocol,
                endpoint: base,
                key: "synthetic".into(),
                model: None,
            };
            let events = Arc::new(std::sync::Mutex::new(Vec::new()));
            let copy = events.clone();
            let channel = Channel::new(move |body| {
                copy.lock().unwrap().push(body);
                Ok(())
            });
            r.drive(
                repo.clone(),
                m,
                h,
                runtime,
                reqwest::Client::builder().no_proxy().build().unwrap(),
                "mock".into(),
                cancel,
                channel,
            )
            .await;
            r.release(&i.request_id).await;
            server.await.unwrap();
            let detail = repo.get(&c.id).await.unwrap();
            if fail_save {
                assert_eq!(detail.messages[1].status, "pending");
                assert_eq!(r.unsaved().await.len(), 1);
                assert!(r.drain(repo.clone()).await.is_err());
                sqlx::query("DROP TRIGGER fail_save")
                    .execute(&repo.pool)
                    .await
                    .unwrap();
                // Another chat/read recovers the expired lease before explicit retry/exit.
                sqlx::query("UPDATE chat_conversations SET lease_until=0 WHERE id=?")
                    .bind(&c.id)
                    .execute(&repo.pool)
                    .await
                    .unwrap();
                repo.recover().await.unwrap();
                r.drain(repo.clone()).await.unwrap();
                assert!(!repo.get(&c.id).await.unwrap().messages[1]
                    .content
                    .is_empty());
                assert!(r.unsaved().await.is_empty());
            } else {
                assert_eq!(detail.messages[1].status, "completed");
                assert_eq!(detail.messages[1].content, "你好");
                assert!(detail.conversation.request_id.is_none());
            }
            assert!(!events.lock().unwrap().is_empty());
        }
        let (_dir, repo) = database().await;
        let c = repo
            .create(CreateInput { title: None })
            .await
            .unwrap()
            .conversation;
        let i = generation(&c);
        let r = instance();
        let cancel = r.reserve(&i).await.unwrap();
        let (m, h) = repo.begin(&i, &r.owner).await.unwrap();
        r.prepare().await;
        let runtime = chat_runtime::Runtime {
            protocol: chat_runtime::Protocol::Chat,
            endpoint: "http://127.0.0.1:1".into(),
            key: "synthetic".into(),
            model: None,
        };
        r.drive(
            repo.clone(),
            m,
            h,
            runtime,
            reqwest::Client::new(),
            "mock".into(),
            cancel,
            Channel::new(|_| Ok(())),
        )
        .await;
        r.release(&i.request_id).await;
        r.drain(repo.clone()).await.unwrap();
        let d = repo.get(&c.id).await.unwrap();
        assert_eq!(d.messages[1].status, "stopped");
        assert!(d.conversation.request_id.is_none());
    }
}
