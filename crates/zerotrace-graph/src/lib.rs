//! Constrained correlation clustering. Scores never union-find by themselves.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum GraphError {
    #[error("must-link and cannot-link conflict on {0} / {1}")]
    ConstraintConflict(u32, u32),
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PairScore {
    pub left: u32,
    pub right: u32,
    pub evidence_score: f64,
    pub must_link: bool,
    pub cannot_link: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClusterAssignment {
    pub confirmed: Vec<Vec<u32>>,
    pub scenario: Vec<Vec<u32>>,
    pub upper: Vec<Vec<u32>>,
    pub unattributed: Vec<u32>,
}

fn parent_of(parent: &mut HashMap<u32, u32>, id: u32) -> u32 {
    let p = *parent.entry(id).or_insert(id);
    if p == id {
        id
    } else {
        let root = parent_of(parent, p);
        parent.insert(id, root);
        root
    }
}

fn union(parent: &mut HashMap<u32, u32>, a: u32, b: u32) {
    let ra = parent_of(parent, a);
    let rb = parent_of(parent, b);
    if ra != rb {
        parent.insert(ra, rb);
    }
}

pub fn constrained_clusters(
    nodes: &[u32],
    pairs: &[PairScore],
    scenario_threshold: f64,
    upper_threshold: f64,
) -> Result<ClusterAssignment, GraphError> {
    let mut parent: HashMap<u32, u32> = nodes.iter().copied().map(|id| (id, id)).collect();
    let mut cannot: HashSet<(u32, u32)> = HashSet::new();
    for pair in pairs {
        let (a, b) = if pair.left < pair.right {
            (pair.left, pair.right)
        } else {
            (pair.right, pair.left)
        };
        if pair.must_link && pair.cannot_link {
            return Err(GraphError::ConstraintConflict(a, b));
        }
        if pair.cannot_link {
            cannot.insert((a, b));
        }
        if pair.must_link {
            union(&mut parent, a, b);
        }
    }
    for pair in pairs {
        if pair.must_link {
            continue;
        }
        let (a, b) = if pair.left < pair.right {
            (pair.left, pair.right)
        } else {
            (pair.right, pair.left)
        };
        if cannot.contains(&(a, b)) {
            continue;
        }
        if pair.evidence_score >= scenario_threshold {
            let ra = parent_of(&mut parent, a);
            let rb = parent_of(&mut parent, b);
            if cannot.contains(&(ra.min(rb), ra.max(rb))) {
                continue;
            }
            union(&mut parent, a, b);
        }
    }

    let mut groups: HashMap<u32, Vec<u32>> = HashMap::new();
    for id in nodes {
        groups
            .entry(parent_of(&mut parent, *id))
            .or_default()
            .push(*id);
    }
    let mut confirmed = Vec::new();
    let mut scenario = Vec::new();
    let mut upper = Vec::new();
    let mut unattributed = Vec::new();
    for members in groups.into_values() {
        if members.len() == 1 {
            unattributed.push(members[0]);
            continue;
        }
        let mut has_must = false;
        let mut max_score: f64 = 0.0;
        for pair in pairs {
            if members.contains(&pair.left) && members.contains(&pair.right) {
                has_must |= pair.must_link;
                max_score = max_score.max(pair.evidence_score);
            }
        }
        if has_must {
            confirmed.push(members);
        } else if max_score >= scenario_threshold {
            scenario.push(members);
        } else if max_score >= upper_threshold {
            upper.push(members);
        } else {
            unattributed.extend(members);
        }
    }
    Ok(ClusterAssignment {
        confirmed,
        scenario,
        upper,
        unattributed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cannot_link_blocks_score_merge() {
        let assignment = constrained_clusters(
            &[1, 2, 3],
            &[
                PairScore {
                    left: 1,
                    right: 2,
                    evidence_score: 0.99,
                    must_link: false,
                    cannot_link: true,
                },
                PairScore {
                    left: 2,
                    right: 3,
                    evidence_score: 0.2,
                    must_link: true,
                    cannot_link: false,
                },
            ],
            0.8,
            0.4,
        )
        .unwrap();
        assert!(assignment
            .confirmed
            .iter()
            .any(|group| group.contains(&2) && group.contains(&3)));
        assert!(
            assignment.unattributed.contains(&1)
                || assignment
                    .confirmed
                    .iter()
                    .all(|g| !g.contains(&1) || !g.contains(&2))
        );
    }

    #[test]
    fn conflicting_constraints_fail_closed() {
        let err = constrained_clusters(
            &[1, 2],
            &[PairScore {
                left: 1,
                right: 2,
                evidence_score: 1.0,
                must_link: true,
                cannot_link: true,
            }],
            0.8,
            0.4,
        )
        .unwrap_err();
        assert!(matches!(err, GraphError::ConstraintConflict(1, 2)));
    }
}
