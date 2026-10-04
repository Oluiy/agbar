package com.example.petclinic.web;

// Real-shaped constructor injection with too many collaborators - the cheap
// signal that this class is doing more than one job.
public class OwnerController {

    public OwnerController(
            OwnerService ownerService,
            PetService petService,
            VisitService visitService,
            VetService vetService,
            NotificationService notificationService,
            AuditLogger auditLogger,
            MetricsRecorder metricsRecorder
    ) {
        // ...
    }

    public String health() {
        return "/health";
    }
}
