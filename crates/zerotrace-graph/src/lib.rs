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

fn normalized_pair(a: u32, b: u32) -> (u32, u32) {
    if a < b {
        (a, b)
    } else {
        (b, a)
    }
}

fn component_merge_violates_cannot_link(
    parent: &mut HashMap<u32, u32>,
    cannot: &HashSet<(u32, u32)>,
    left_root: u32,
    right_root: u32,
) -> bool {
    cannot.iter().any(|(left, right)| {
        let cannot_left_root = parent_of(parent, *left);
        let cannot_right_root = parent_of(parent, *right);
        (cannot_left_root == left_root && cannot_right_root == right_root)
            || (cannot_left_root == right_root && cannot_right_root == left_root)
    })
}

fn build_partition(
    nodes: &[u32],
    pairs: &[PairScore],
    cannot: &HashSet<(u32, u32)>,
    threshold: Option<f64>,
) -> Result<(Vec<Vec<u32>>, Vec<u32>), GraphError> {
    let mut parent: HashMap<u32, u32> = nodes.iter().copied().map(|id| (id, id)).collect();
    for pair in pairs.iter().filter(|pair| pair.must_link) {
        union(&mut parent, pair.left, pair.right);
    }

    for &(left, right) in cannot {
        if parent_of(&mut parent, left) == parent_of(&mut parent, right) {
            return Err(GraphError::ConstraintConflict(left, right));
        }
    }

    if let Some(minimum_score) = threshold {
        let mut candidates = pairs
            .iter()
            .filter(|pair| !pair.must_link && !pair.cannot_link)
            .collect::<Vec<_>>();
        candidates.sort_by(|left, right| {
            right
                .evidence_score
                .total_cmp(&left.evidence_score)
                .then_with(|| {
                    normalized_pair(left.left, left.right)
                        .cmp(&normalized_pair(right.left, right.right))
                })
        });
        for pair in candidates {
            if pair.evidence_score < minimum_score {
                continue;
            }
            let left_root = parent_of(&mut parent, pair.left);
            let right_root = parent_of(&mut parent, pair.right);
            if left_root == right_root
                || component_merge_violates_cannot_link(&mut parent, cannot, left_root, right_root)
            {
                continue;
            }
            union(&mut parent, left_root, right_root);
        }
    }

    let mut grouped: HashMap<u32, Vec<u32>> = HashMap::new();
    for id in nodes {
        grouped
            .entry(parent_of(&mut parent, *id))
            .or_default()
            .push(*id);
    }
    let mut groups = Vec::new();
    let mut singletons = Vec::new();
    for mut members in grouped.into_values() {
        members.sort_unstable();
        if members.len() == 1 {
            singletons.push(members[0]);
        } else {
            groups.push(members);
        }
    }
    groups.sort();
    singletons.sort_unstable();
    Ok((groups, singletons))
}

pub fn constrained_clusters(
    nodes: &[u32],
    pairs: &[PairScore],
    scenario_threshold: f64,
    upper_threshold: f64,
) -> Result<ClusterAssignment, GraphError> {
    let mut cannot: HashSet<(u32, u32)> = HashSet::new();
    for pair in pairs {
        let (a, b) = normalized_pair(pair.left, pair.right);
        if pair.must_link && pair.cannot_link {
            return Err(GraphError::ConstraintConflict(a, b));
        }
        if pair.cannot_link {
            cannot.insert((a, b));
        }
    }

    let (confirmed, _) = build_partition(nodes, pairs, &cannot, None)?;
    let (scenario, _) = build_partition(nodes, pairs, &cannot, Some(scenario_threshold))?;
    let (upper, unattributed) = build_partition(nodes, pairs, &cannot, Some(upper_threshold))?;
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

    #[test]
    fn cannot_link_blocks_a_transitive_component_merge() {
        let assignment = constrained_clusters(
            &[1, 2, 3],
            &[
                PairScore {
                    left: 1,
                    right: 3,
                    evidence_score: 0.0,
                    must_link: false,
                    cannot_link: true,
                },
                PairScore {
                    left: 2,
                    right: 3,
                    evidence_score: 1.0,
                    must_link: true,
                    cannot_link: false,
                },
                PairScore {
                    left: 1,
                    right: 2,
                    evidence_score: 0.99,
                    must_link: false,
                    cannot_link: false,
                },
            ],
            0.8,
            0.4,
        )
        .unwrap();
        assert_eq!(assignment.confirmed, vec![vec![2, 3]]);
        assert_eq!(assignment.scenario, vec![vec![2, 3]]);
        assert_eq!(assignment.upper, vec![vec![2, 3]]);
        assert_eq!(assignment.unattributed, vec![1]);
    }

    #[test]
    fn indirect_must_link_cannot_link_conflict_fails_closed() {
        let err = constrained_clusters(
            &[1, 2, 3],
            &[
                PairScore {
                    left: 1,
                    right: 2,
                    evidence_score: 1.0,
                    must_link: true,
                    cannot_link: false,
                },
                PairScore {
                    left: 2,
                    right: 3,
                    evidence_score: 1.0,
                    must_link: true,
                    cannot_link: false,
                },
                PairScore {
                    left: 1,
                    right: 3,
                    evidence_score: 0.0,
                    must_link: false,
                    cannot_link: true,
                },
            ],
            0.8,
            0.4,
        )
        .unwrap_err();
        assert!(matches!(err, GraphError::ConstraintConflict(1, 3)));
    }
}
