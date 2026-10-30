use super::*;
use crate::daemon::terminal_resources::Budget;
fn fixture(script: &str) -> SpawnedPty {
    spawn(PtyLaunchOptions {
        exe: "powershell.exe".into(),
        args: vec![
            "-NoProfile".into(),
            "-NonInteractive".into(),
            "-Command".into(),
            script.into(),
        ],
        cwd: None,
        env: Default::default(),
        cols: 80,
        rows: 24,
    })
    .unwrap()
}
#[test]
fn terminal_resources_real_job_children_and_explicit_terminate_with_borrow() {
    let mut control = fixture("Start-Sleep -Seconds 60");
    let mut tree = fixture("$p=Start-Process powershell.exe -ArgumentList '-NoProfile -NonInteractive -Command $a=New-Object byte[] 67108864; for($i=0;$i -lt $a.Length;$i+=4096){$a[$i]=1}; Start-Sleep -Seconds 60' -PassThru; Start-Sleep -Seconds 60");
    let reader = std::mem::replace(&mut tree.reader, Box::new(std::io::empty()));
    let drain = std::thread::spawn(move || {
        let _ = std::io::copy(&mut { reader }, &mut std::io::sink());
    });
    let reader = std::mem::replace(&mut control.reader, Box::new(std::io::empty()));
    let control_drain = std::thread::spawn(move || {
        let _ = std::io::copy(&mut { reader }, &mut std::io::sink());
    });
    let deadline = Instant::now() + Duration::from_secs(15);
    let row = loop {
        let row = tree.child.sample_resources("tree", &mut Budget::new());
        if row.observed_count >= 2 && row.working_set_sum_bytes.unwrap_or(0) > 64 * 1024 * 1024
            || Instant::now() >= deadline
        {
            break row;
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    // A borrow can outlive explicit close, but may neither lock nor suppress terminate.
    let borrowed = tree.child.clone();
    let sample_child = borrowed.clone();
    let sampler =
        std::thread::spawn(move || sample_child.sample_resources("tree", &mut Budget::new()));
    let killed = tree.child.kill();
    let _ = sampler.join().unwrap();
    let end = Instant::now() + Duration::from_secs(5);
    while !tree.child.tree_stopped().unwrap_or(false) && Instant::now() < end {
        std::thread::sleep(Duration::from_millis(10));
    }
    let stopped = tree.child.tree_stopped().unwrap_or(false);
    let stale = borrowed.sample_resources("tree", &mut Budget::new());
    let control_alive = control.child.try_wait().unwrap().is_none();
    let _ = control.child.kill();
    drop(borrowed);
    drop(tree);
    drop(control);
    drain.join().unwrap();
    control_drain.join().unwrap();
    assert!(killed.is_ok() && stopped);
    assert!(control_alive);
    assert!(row.observed_count >= 2, "{row:?}");
    assert!(
        row.working_set_sum_bytes.unwrap_or(0) > 64 * 1024 * 1024,
        "{row:?}"
    );
    assert_eq!(stale.working_set_sum_bytes, None);
    assert!(stale.reason_codes.contains(&"root_changed".into()));
}
